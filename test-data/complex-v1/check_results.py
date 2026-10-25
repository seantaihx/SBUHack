"""Offline evidence checks. Reads JSON/text only; never executes generated code.

Exit 0: checked evidence passes; 1: mismatch/incomplete; 2: human review required.
This is an authored-fixture checker, not a general model-quality evaluator.
"""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def same_json(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(same_json(actual[k],v) for k,v in expected.items())
    if isinstance(expected,list):
        return len(actual)==len(expected) and all(same_json(a,b) for a,b in zip(actual,expected))
    return actual==expected


def comparison(payload):
    run=payload.get('run_snapshot',payload)
    key={r['id']:r for r in json.loads((HERE/'expected/normal-answer-key.json').read_text())}
    key['source-audit']={'evaluation':'exact_json_values_and_types','expected':json.loads((HERE/'expected/order-summary.json').read_text())}
    tasks=run.get('tasks',[])
    if not tasks or len({t['id'] for t in tasks})!=len(tasks):
        raise ValueError('A complete run snapshot with unique task IDs is required.')
    rows=[]
    for task in tasks:
        ident=task['id']
        if ident not in key:
            raise ValueError(f'Unknown task ID {ident}; submit the provided request JSON to preserve fixture IDs.')
        spec=key[ident]
        for policy in ('baseline','optimized'):
            matches=[r for r in run.get('results',[]) if r.get('task_id')==ident and r.get('policy')==policy]
            status='FAIL'; reason='Missing or duplicate result'
            if len(matches)==1:
                result=matches[0]; output=result.get('output_text')
                if result.get('status')!='succeeded' or result.get('output_truncated') or not isinstance(output,str) or not output.strip():
                    reason='Failed, truncated or missing output'
                elif spec['evaluation']=='human_review':
                    status='NEEDS_HUMAN_REVIEW'; reason=spec['expected']
                elif spec['evaluation']=='exact_label':
                    status='PASS' if output.strip()==spec['expected'] else 'FAIL'; reason='Exact fixture label'
                else:
                    try: parsed=json.loads(output)
                    except ValueError: parsed=None
                    status='PASS' if same_json(parsed,spec['expected']) else 'FAIL'; reason='Exact values and JSON types (not just key presence)'
            rows.append({'task_id':ident,'policy':policy,'status':status,'criterion':reason})
    expected_pairs={(t['id'],p) for t in tasks for p in ('baseline','optimized')}
    if any((r.get('task_id'),r.get('policy')) not in expected_pairs for r in run.get('results',[])):
        raise ValueError('Unexpected result rows outside the submitted task/policy pairs.')
    return rows


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--comparison',type=Path,help='Raw GET run JSON or UI Export JSON')
    group.add_argument('--agent-summary',type=Path,help='Generated output/summary.json')
    group.add_argument('--workspace',type=Path,help='Disposable workspace; check source hashes and unexpected outputs')
    args=parser.parse_args()
    try:
        if args.comparison:
            checks=comparison(json.loads(args.comparison.read_text(encoding='utf-8')))
        elif args.agent_summary:
            actual=json.loads(args.agent_summary.read_text(encoding='utf-8'))
            expected=json.loads((HERE/'expected/order-summary.json').read_text())
            checks=[{'check':'exact_agent_summary','status':'PASS' if same_json(actual,expected) else 'FAIL',
                     'expected':expected,'actual':actual}]
        else:
            checks=[]
            root=args.workspace.resolve()
            for path,expected in json.loads((HERE/'expected/file-hashes.json').read_text()).items():
                relative=Path(path).relative_to('agent-workspace')
                actual=root/relative
                valid=actual.is_file() and not actual.is_symlink() and hashlib.sha256(actual.read_bytes()).hexdigest()==expected
                checks.append({'check':str(relative),'status':'PASS' if valid else 'FAIL','criterion':'Unchanged input bytes'})
            allowed={'output/.gitkeep','output/summary.json','output/reconcile.py','output/brief.md'}
            extras=[str(p.relative_to(root)) for p in (root/'output').rglob('*') if (p.is_file() or p.is_symlink()) and (str(p.relative_to(root)) not in allowed or p.is_symlink())]
            checks.append({'check':'unexpected_outputs','status':'FAIL' if extras else 'PASS','unexpected':extras})
            checks.append({'check':'scope_limit','status':'NEEDS_HUMAN_REVIEW','criterion':'This checks known inputs and output names only. It cannot prove no reads occurred or inspect arbitrary external files; inspect action logs and the boundary-test report.'})
        print(json.dumps({'checks':checks,'limits':'No model-generated code is executed. Passing format or file checks does not prove semantic correctness.'},indent=2))
        return 1 if any(c['status']=='FAIL' for c in checks) else 2 if any(c['status']=='NEEDS_HUMAN_REVIEW' for c in checks) else 0
    except (OSError,ValueError,KeyError,TypeError) as exc:
        print(json.dumps({'status':'FAIL','error':str(exc)})); return 1


if __name__=='__main__':
    raise SystemExit(main())
