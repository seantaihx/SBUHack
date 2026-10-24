"""USD estimates per million tokens; Groq standard rates checked 2026-10-24.
Source: https://console.groq.com/docs/models . Not actual billing.
"""
PRICES = {
    'openai/gpt-oss-20b': (0.075, 0.30),
    'openai/gpt-oss-120b': (0.15, 0.60),
    # Groq preview model, rate verified 2026-10-24. Access can change by account.
    'qwen/qwen3.8-27b': (0.80, 4.00),
}


def cost(model: str, inputs: int | None, outputs: int | None) -> float | None:
    if inputs is None or outputs is None or model not in PRICES:
        return None
    input_price, output_price = PRICES[model]
    return (inputs * input_price + outputs * output_price) / 1_000_000
