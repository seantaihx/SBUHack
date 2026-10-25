"""USD per million tokens; rates are estimates, not invoices.

Provider model catalog rates are checked against first-party pricing on 2026-10-24.
"""
from datetime import date

from .model_catalog import get_model, normalize_model_key

PRICES = {
    'openai/gpt-oss-20b': (0.075, 0.30),
    'openai/gpt-oss-120b': (0.15, 0.60),
    # Groq preview model, rate verified 2026-10-24. Access can change by account.
    'qwen/qwen3.8-27b': (0.80, 4.00),
}


def rates(model: str) -> tuple[float, float] | None:
    key = normalize_model_key(model)
    spec = get_model(key)
    if spec is not None:
        if key == 'gemini::gemini-3.8-flash' and date.today() >= date(2027, 1, 1):
            return (1.50, 7.50)
        return spec.input_usd_per_million, spec.output_usd_per_million
    return PRICES.get(model)


def cost(model: str, inputs: int | None, outputs: int | None) -> float | None:
    model_rates = rates(model)
    if inputs is None or outputs is None or model_rates is None:
        return None
    input_price, output_price = model_rates
    return (inputs * input_price + outputs * output_price) / 1_000_000
