"""Illustrative estimates and matched-cohort comparisons, without rounding."""
from .schemas import Comparison, ComparisonMetric, EnergyProfile, Result, Role


def estimate(profile: EnergyProfile, role: Role, inputs: int | None, outputs: int | None,
             intensity: float) -> tuple[float | None, float | None]:
    if inputs is None or outputs is None:
        return None, None
    coefficients = getattr(profile.models, role)
    energy = inputs * coefficients.input_wh_per_token + outputs * coefficients.output_wh_per_token
    return energy, energy / 1000 * intensity


def _metric(pairs: list[tuple[Result, Result]], field: str) -> ComparisonMetric:
    if not pairs:
        return ComparisonMetric()
    baseline = sum(getattr(pair[0], field) for pair in pairs)
    optimized = sum(getattr(pair[1], field) for pair in pairs)
    saved = baseline - optimized
    return ComparisonMetric(baseline=baseline, optimized=optimized, saved=saved,
                            savings_pct=saved / baseline * 100 if baseline > 0 else None)


def compare(results: list[Result]) -> Comparison:
    by_task = {}
    for result in results:
        by_task.setdefault(result.task_id, {})[result.policy] = result
    successful = [(rows['baseline'], rows['optimized']) for rows in by_task.values()
                  if 'baseline' in rows and 'optimized' in rows
                  and rows['baseline'].status == rows['optimized'].status == 'succeeded']
    energy = [pair for pair in successful if all(r.input_tokens is not None and r.output_tokens is not None
                                               for r in pair)]
    gpu_energy = [pair for pair in successful if all(r.measured_gpu_energy_wh is not None for r in pair)]
    return Comparison(successful_pairs=len(successful), energy_pairs=len(energy),
                      measured_gpu_energy_pairs=len(gpu_energy), latency_pairs=len(successful),
                      energy_wh=_metric(energy, 'estimated_energy_wh'),
                      measured_gpu_energy_wh=_metric(gpu_energy, 'measured_gpu_energy_wh'),
                      carbon_g=_metric(energy, 'estimated_carbon_g'),
                      latency_ms=_metric(successful, 'latency_ms'))
