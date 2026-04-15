import os
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import anthropic
import openai
import google.generativeai as genai

# ~4 characters per token is a safe estimate for English text
CHARS_PER_TOKEN = 4

# GPT org limit is 30,000 TPM; reserve 4,096 for output → ~25,904 input tokens
GPT_MAX_INPUT_TOKENS = 25_000
GPT_MAX_OUTPUT_TOKENS = 4_096


def _estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN


def _build_full_prompt(prompt_text: str, context_files: list[dict] = None) -> str:
    full = prompt_text
    if context_files:
        full += "\n\n---\n\n## Attached Context Files\n"
        for f in context_files:
            full += f"\n### {f['name']}\n\n{f['content']}\n"
    return full


def _build_truncated_prompt(prompt_text: str, context_files: list[dict] = None, max_input_tokens: int = GPT_MAX_INPUT_TOKENS) -> tuple[str, bool]:
    """Build prompt and truncate context files if the total exceeds max_input_tokens.
    Returns (prompt_text, was_truncated)."""
    max_chars = max_input_tokens * CHARS_PER_TOKEN
    base = prompt_text
    was_truncated = False

    if not context_files:
        return base, False

    header = "\n\n---\n\n## Attached Context Files\n"
    base_tokens = _estimate_tokens(base + header)
    remaining_chars = max_chars - (base_tokens * CHARS_PER_TOKEN)

    if remaining_chars <= 0:
        # Prompt itself is too long — truncate it
        base = prompt_text[: max_chars - len(header)]
        was_truncated = True
        remaining_chars = 0

    assembled_files = ""
    for f in context_files:
        file_header = f"\n### {f['name']}\n\n"
        available = remaining_chars - len(assembled_files) - len(file_header) - 50  # 50-char safety buffer
        if available <= 0:
            was_truncated = True
            break
        content = f["content"]
        if len(content) > available:
            content = content[:available] + "\n\n[... content truncated to fit token limit ...]"
            was_truncated = True
        assembled_files += file_header + content + "\n"

    full = base + header + assembled_files
    return full, was_truncated


def run_opus(prompt_text: str, context_files: list[dict] = None) -> dict:
    try:
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        full_prompt = _build_full_prompt(prompt_text, context_files)

        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=8192,
            messages=[{"role": "user", "content": full_prompt}]
        )
        return {
            "model": "Opus 4.6",
            "response": response.content[0].text,
            "status": "success"
        }
    except Exception as e:
        return {
            "model": "Opus 4.6",
            "response": "",
            "status": "error",
            "error": str(e)
        }


def run_gpt(prompt_text: str, context_files: list[dict] = None) -> dict:
    try:
        client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        full_prompt, was_truncated = _build_truncated_prompt(prompt_text, context_files, GPT_MAX_INPUT_TOKENS)

        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=GPT_MAX_OUTPUT_TOKENS,
            messages=[{"role": "user", "content": full_prompt}]
        )
        result = {
            "model": "GPT 5.4",
            "response": response.choices[0].message.content,
            "status": "success"
        }
        if was_truncated:
            result["warning"] = "Context was truncated to fit within the 30,000 TPM token limit."
        return result
    except Exception as e:
        return {
            "model": "GPT 5.4",
            "response": "",
            "status": "error",
            "error": str(e)
        }


def run_gemini(prompt_text: str, context_files: list[dict] = None) -> dict:
    try:
        genai.configure(api_key=os.getenv("GOOGLE_AI_API_KEY"))
        model = genai.GenerativeModel("gemini-2.0-flash")
        full_prompt = _build_full_prompt(prompt_text, context_files)

        response = model.generate_content(full_prompt)
        return {
            "model": "Gemini 3.1 Pro",
            "response": response.text,
            "status": "success"
        }
    except Exception as e:
        return {
            "model": "Gemini 3.1 Pro",
            "response": "",
            "status": "error",
            "error": str(e)
        }


MODEL_RUNNERS = {
    "opus": run_opus,
    "gpt": run_gpt,
    "gemini": run_gemini
}


def run_models(prompt_text: str, context_files: list[dict] = None, models: list[str] = None) -> list[dict]:
    if models is None:
        models = ["opus", "gpt", "gemini"]

    results = []

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {}
        for model_key in models:
            if model_key in MODEL_RUNNERS:
                future = executor.submit(MODEL_RUNNERS[model_key], prompt_text, context_files)
                futures[future] = model_key

        for future in as_completed(futures):
            results.append(future.result())

    model_order = {"GPT 5.4": 0, "Gemini 3.1 Pro": 1, "Opus 4.6": 2}
    results.sort(key=lambda r: model_order.get(r["model"], 99))

    return results
