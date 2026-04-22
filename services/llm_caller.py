"""
Unified LLM caller — routes to Anthropic, OpenAI, or Google AI
based on the model identifier passed in.
"""
import os
import requests
import anthropic
import openai

AVAILABLE_MODELS = {
    "claude-sonnet-4-6": {"name": "Claude Sonnet 4.6", "provider": "anthropic"},
    "claude-opus-4-6":   {"name": "Claude Opus 4.6",   "provider": "anthropic"},
    "gpt-5.4":           {"name": "GPT 5.4",           "provider": "openai"},
    "gemini-3.1-pro-preview": {"name": "Gemini 3.1 Pro", "provider": "google"},
}

DEFAULT_MODELS = {
    "prompt": "claude-sonnet-4-6",
    "rubric": "claude-sonnet-4-6",
    "rhea":   "claude-opus-4-6",
}

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def model_display_name(model_id: str) -> str:
    return AVAILABLE_MODELS.get(model_id, {}).get("name", model_id)


def call_llm(model: str, system_prompt: str, user_message: str, max_tokens: int = 8192) -> str:
    """
    Call any supported LLM with a system prompt and user message.
    Returns the raw text response.
    Raises on API errors.
    """
    provider = AVAILABLE_MODELS.get(model, {}).get("provider")

    if provider == "anthropic":
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        return response.content[0].text

    elif provider == "openai":
        client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=model,
            max_completion_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_message},
            ],
        )
        return response.choices[0].message.content

    elif provider == "google":
        api_key = os.getenv("GOOGLE_AI_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_AI_API_KEY is not configured. Add it in Settings → API Keys.")
        url = GEMINI_API_URL.format(model=model)
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"parts": [{"text": user_message}]}],
            "generationConfig": {"maxOutputTokens": min(max_tokens, 8192)},
        }
        resp = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            params={"key": api_key},
            timeout=300,
        )
        resp.raise_for_status()
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]

    else:
        raise ValueError(f"Unknown or unsupported model: '{model}'. "
                         f"Valid options: {list(AVAILABLE_MODELS)}")
