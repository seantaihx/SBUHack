"""Only the agreed starter dataset is executable; policy proposals are excluded."""
import json
from ..settings import ROOT


def dataset(dataset_id='starter-v1'):
    if dataset_id not in {'starter-v1', 'starter-v2'}:
        return None
    return json.loads((ROOT / f'benchmarks/{dataset_id}.json').read_text(encoding='utf-8'))


def expected_text(case):
    value = case['expected']
    return json.dumps(value, separators=(',', ':'), sort_keys=True) if isinstance(value, dict) else value


def evaluate(case, output: str) -> bool:
    method = case['evaluation']['method']
    if method == 'exact_match':
        expected = case['expected'].strip()
        actual = output.strip()
        return actual == expected if case['evaluation'].get('case_sensitive', True) else actual.casefold() == expected.casefold()
    if method == 'json_schema_and_values':
        try:
            parsed = json.loads(output)
        except (ValueError, TypeError):
            return False
        expected = case['expected']
        # JSON booleans are not numbers, and additional fields do not satisfy this exact-object rubric.
        return (isinstance(parsed, dict) and parsed.keys() == expected.keys()
                and all(not isinstance(parsed[k], bool) and parsed[k] == value for k, value in expected.items()))
    if method == 'required_facts':
        # Deliberately lexical, not a semantic/LLM judge. Canonical expected answer
        # OR every authored phrase must match after case/whitespace normalization.
        norm = lambda text: ' '.join(text.casefold().split())
        actual = norm(output)
        return actual == norm(case['expected']) or all(norm(fact) in actual for fact in case['evaluation']['required_facts'])
    raise ValueError('Unsupported benchmark evaluator')
