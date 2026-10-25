"""Executable checks for test-data/complex-v1. No live provider or network calls."""
import csv
import hashlib
import json
import importlib.util
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app.agent_schemas import AgentStartRequest, AgentWorkflowStartRequest
from backend.app.benchmarks.schemas import StartBenchmarkRequest
from backend.app.providers.base import InferenceResult
from backend.app.schemas import CreateRun, CreateTextSource
from backend.app.sources import SourceFailure, _validate_public_url, parse_csv, parse_pdf
from test_agents import agent_client, approve, propose, wait_for

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / 'test-data/complex-v1'


def load(path):
    return json.loads((PACK / path).read_text(encoding='utf-8'))


def start_body(**overrides):
    return dict(task_type='code', instruction='Update only allowed.txt.',
                confirm_provider_submission=True, read_paths=['allowed.txt'],
                write_paths=['allowed.txt'], max_steps=4, **overrides)


@pytest.mark.parametrize('filename', ['00-demo.json', '01-live-comparison.json', '02-live-comparison.json', '03-live-source-template.json'])
def test_comparison_payloads_match_contract_and_default_request_cap(filename):
    body = CreateRun.model_validate_json((PACK/'requests'/filename).read_text())
    assert len(body.tasks) * (2 + int(body.quality_fallback)) <= 20


@pytest.mark.parametrize('filename,model', [
    ('agent-single.json', AgentStartRequest), ('agent-manager.json', AgentWorkflowStartRequest),
    ('benchmark-starter-v1.json', StartBenchmarkRequest), ('benchmark-starter-v2.json', StartBenchmarkRequest),
    ('source-text-preview.json', CreateTextSource),
])
def test_other_payloads_match_current_contract(filename, model):
    model.model_validate_json((PACK/'requests'/filename).read_text())


def test_order_answer_key_reconciles_independently():
    with (PACK/'sources/orders.csv').open(newline='',encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    # Sort by revision, then overwrite: independent of generator's max-selection loop.
    selected = {row['order_id']:row for row in sorted(rows,key=lambda r:int(r['revision']))}
    included = [r for r in selected.values() if r['currency']=='USD' and r['status']=='paid']
    key = load('expected/order-summary.json')
    assert len(rows) == key['raw_rows'] == 26
    assert len(selected) == key['unique_orders'] == 24
    assert len(included) == key['included_orders'] == 11
    assert sum(Decimal(r['gross']) for r in included) == Decimal(key['gross_usd']) == Decimal('417.23')
    assert sum(Decimal(r['refund']) for r in included) == Decimal(key['refund_usd']) == Decimal('10.00')
    assert Decimal(key['gross_usd']) - Decimal(key['refund_usd']) == Decimal(key['net_usd']) == Decimal('407.23')
    assert sorted(r['order_id'] for r in included) == key['included_order_ids']
    assert set(key['included_order_ids']).isdisjoint(key['excluded_order_ids'])
    assert set(selected) == set(key['included_order_ids'] + key['excluded_order_ids'])


@pytest.mark.parametrize('filename,rows', [('orders.csv',26),('support-tickets.csv',12)])
def test_generated_csv_imports_without_losing_quotes_unicode_or_newlines(filename,rows):
    source = parse_csv((PACK/'sources'/filename).read_bytes(),filename)
    assert source.unit_count == rows
    assert source.references_complete
    if filename == 'orders.csv':
        assert 'Café' in source.extracted_text
        assert 'Line one\nLine two' in source.extracted_text
        assert '=1+1' in source.extracted_text
        assert '999999' in source.extracted_text


def test_selectable_pdf_has_two_page_references():
    source = parse_pdf((ROOT/'output/pdf/feature-test-pack/policy-selectable.pdf').read_bytes(),'policy.pdf')
    assert source.unit_count == 2
    assert {r.page_number for r in source.references} == {1,2}
    assert 'POLICY v2' in source.extracted_text


@pytest.mark.parametrize('filename,code',[('policy-scanned.pdf','SOURCE_PDF_SCANNED'),('policy-encrypted.pdf','SOURCE_PDF_ENCRYPTED')])
def test_negative_pdf_inputs_are_honestly_rejected(filename,code):
    with pytest.raises(SourceFailure) as failure:
        parse_pdf((ROOT/'output/pdf/feature-test-pack'/filename).read_bytes(),filename)
    assert failure.value.code == code


def test_agent_inputs_match_published_hashes():
    for path, expected in load('expected/file-hashes.json').items():
        assert hashlib.sha256((PACK/path).read_bytes()).hexdigest() == expected


@pytest.mark.parametrize('case',load('guard-actions.json'), ids=lambda c:c['id'])
def test_forced_forbidden_model_actions_are_blocked_with_unchanged_files(tmp_path,case):
    client, settings = agent_client(tmp_path)
    target = settings.agent_workspace_root/'allowed.txt'; target.write_text('ORIGINAL')
    outside = tmp_path/'outside.txt'; outside.write_text('OUTSIDE_SENTINEL')
    response = InferenceResult(json.dumps({'summary':'Synthetic boundary probe.', 'action':case['action']}),10,50,20,'stop',False)
    with client:
        mock = AsyncMock(return_value=response)
        client.app.state.agents.live.infer = mock
        started = client.post('/api/v1/agent-runs',json=start_body())
        assert started.status_code == 202
        run = wait_for(client,started.json()['run_id'],'paused')
        assert run['stop_reason'] == case['expected_stop_reason']
        assert run['pending_action'] is None and run['steps_completed'] == 0
        assert run['events'][-1]['decision'] == 'denied_out_of_scope'
        assert target.read_text() == 'ORIGINAL' and outside.read_text() == 'OUTSIDE_SENTINEL'
        assert sorted(p.name for p in settings.agent_workspace_root.iterdir()) == ['allowed.txt']
        assert not any(e['actor']=='tool' and e['decision']=='completed' for e in run['events'])
        assert mock.await_count == 1


@pytest.mark.parametrize('path',['../outside.txt','/tmp/outside.txt','.env','.git/config','.ssh/id_rsa','nested/../../outside.txt','C:\\outside.txt'])
def test_bad_scope_is_rejected_before_provider_dispatch(tmp_path,path):
    client, _ = agent_client(tmp_path)
    with client:
        mock = AsyncMock(side_effect=AssertionError('No provider call permitted'))
        client.app.state.agents.live.infer = mock
        body = start_body(); body['write_paths']=[path]
        response = client.post('/api/v1/agent-runs',json=body)
        assert response.status_code == 422
        assert response.json()['error']['code'] == 'AGENT_PATH_NOT_ALLOWED'
        mock.assert_not_awaited()


def test_symlink_escape_is_rejected_before_provider_dispatch(tmp_path):
    client,settings=agent_client(tmp_path)
    outside=tmp_path/'outside.txt'; outside.write_text('OUTSIDE_SENTINEL')
    try:
        (settings.agent_workspace_root/'allowed.txt').symlink_to(outside)
    except OSError:
        pytest.skip('Symlink creation unavailable on this test platform')
    with client:
        mock=AsyncMock(side_effect=AssertionError('No provider call permitted'))
        client.app.state.agents.live.infer=mock
        response=client.post('/api/v1/agent-runs',json=start_body())
        assert response.status_code == 422
        assert outside.read_text() == 'OUTSIDE_SENTINEL'
        mock.assert_not_awaited()


@pytest.mark.parametrize('decision',['approve','deny','wrong_hash','changed_file','symlink_swap'])
def test_exact_approval_gate_has_a_positive_control_and_negative_controls(tmp_path,decision):
    client,settings=agent_client(tmp_path)
    target=settings.agent_workspace_root/'allowed.txt'; target.write_text('ORIGINAL')
    outside=tmp_path/'outside.txt'; outside.write_text('OUTSIDE_SENTINEL')
    with client:
        client.app.state.agents.live.infer=AsyncMock(return_value=propose('write_file','allowed.txt','APPROVED_CONTENT'))
        started=client.post('/api/v1/agent-runs',json=start_body())
        run=wait_for(client,started.json()['run_id'],'awaiting_approval')
        assert target.read_text()=='ORIGINAL' and run['steps_completed']==0
        pending=run['pending_action']
        if decision=='changed_file': target.write_text('USER_EDIT')
        if decision=='symlink_swap':
            target.unlink()
            try: target.symlink_to(outside)
            except OSError: pytest.skip('Symlinks unavailable')
        response=client.post(f"/api/v1/agent-runs/{run['run_id']}/approvals",json={
            'action_id':pending['action_id'],
            'action_hash':'0'*64 if decision=='wrong_hash' else pending['action_hash'],
            'approved':decision!='deny',
        })
        if decision=='wrong_hash':
            assert response.status_code==409 and target.read_text()=='ORIGINAL'
        else:
            assert response.status_code==200
            if decision=='approve':
                assert target.read_text()=='APPROVED_CONTENT' and response.json()['steps_completed']==1
            elif decision in ('changed_file','symlink_swap'):
                assert response.json()['stop_reason']=='WORKSPACE_CHANGED'
                assert target.read_text()==('USER_EDIT' if decision=='changed_file' else 'OUTSIDE_SENTINEL')
            else: assert target.read_text()=='ORIGINAL' and response.json()['steps_completed']==0
        assert outside.read_text()=='OUTSIDE_SENTINEL'


@pytest.mark.parametrize('case',load('source-url-denials.json'),ids=lambda c:c['url'])
def test_source_network_boundaries_reject_before_connection(case):
    # Numeric private addresses and malformed URLs need neither DNS nor HTTP.
    def no_dns(*args,**kwargs):
        raise AssertionError('Blocked fixture must not reach DNS')
    with pytest.raises(SourceFailure) as failure:
        _validate_public_url(case['url'],resolver=no_dns)
    assert failure.value.code==case['expected_code']


def test_remote_agent_caller_is_blocked_before_provider_dispatch(tmp_path):
    client,_=agent_client(tmp_path)
    with client:
        mock=AsyncMock(side_effect=AssertionError('No provider call permitted'))
        client.app.state.agents.live.infer=mock
        remote=TestClient(client.app,base_url='http://127.0.0.1',client=('192.0.2.15',1234))
        assert remote.post('/api/v1/agent-runs',json=start_body()).status_code==403
        mock.assert_not_awaited()


def checker_module():
    spec=importlib.util.spec_from_file_location('feature_pack_checker',PACK/'check_results.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('output,expected',[('billing','PASS'),('technical','FAIL')])
def test_answer_checker_requires_correct_label_not_merely_allowed_label(output,expected):
    run={'status':'completed','tasks':[{'id':'C01'}], 'results':[
        {'task_id':'C01','policy':policy,'status':'succeeded','output_text':output}
        for policy in ('baseline','optimized')]}
    assert all(row['status']==expected for row in checker_module().comparison(run))


def test_answer_checker_preserves_manual_review_and_missing_evidence():
    run={'status':'completed','tasks':[{'id':'W01'}], 'results':[
        {'task_id':'W01','policy':'baseline','status':'succeeded','output_text':'A draft that still needs review.'}]}
    checks=checker_module().comparison(run)
    assert [r['status'] for r in checks]==['NEEDS_HUMAN_REVIEW','FAIL']


def test_answer_checker_does_not_accept_wrong_json_types_or_incomplete_runs():
    checker=checker_module()
    assert not checker.same_json({'quantity':'12'},{'quantity':12})
    assert not checker.same_json({'quantity':True},{'quantity':1})
    with pytest.raises(ValueError,match='completed run'):
        checker.comparison({'status':'running','tasks':[{'id':'C01'}],'results':[]})
