import os
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import anthropic
import openai
import google.generativeai as genai

# ~4 characters per token is a safe estimate for English text
CHARS_PER_TOKEN = 4

# GPT org TPM limit is 30,000; reserve 4,096 for output → ~25,904 input tokens max
# We use 20,000 to stay comfortably under the limit
GPT_MAX_INPUT_TOKENS = 20_000
GPT_MAX_OUTPUT_TOKENS = 4_096
GPT_MODEL = "gpt-5.4"


def _build_full_prompt(prompt_text: str, context_files: list[dict] = None) -> str:
    full = prompt_text
    if context_files:
        full += "\n\n---\n\n## Attached Context Files\n"
        for f in context_files:
            full += f"\n### {f['name']}\n\n{f['content']}\n"
    return full


def _build_truncated_prompt(prompt_text: str, context_files: list[dict] = None, max_input_tokens: int = GPT_MAX_INPUT_TOKENS) -> tuple[str, bool]:
    """Build prompt truncating context files so total stays within max_input_tokens.
    Returns (prompt_text, was_truncated)."""
    max_chars = max_input_tokens * CHARS_PER_TOKEN

    full = _build_full_prompt(prompt_text, context_files)

    if len(full) <= max_chars:
        return full, False

    # Hard truncate: keep the prompt intact and trim context progressively
    header = "\n\n---\n\n## Attached Context Files\n"
    base = prompt_text
    budget = max_chars - len(base) - len(header) - 100  # 100-char safety buffer

    if budget <= 0:
        # Even the base prompt is too big — truncate it
        truncated = (prompt_text[:max_chars] +
                     "\n\n[... prompt truncated to fit token limit ...]")
        return truncated, True

    assembled_files = ""
    for f in context_files or []:
        file_header = f"\n### {f['name']}\n\n"
        space_left = budget - len(assembled_files) - len(file_header)
        if space_left <= 0:
            break
        content = f["content"]
        if len(content) > space_left:
            content = content[:space_left] + "\n\n[... truncated to fit token limit ...]"
        assembled_files += file_header + content + "\n"

    return base + header + assembled_files, True


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
            model=GPT_MODEL,
            max_completion_tokens=GPT_MAX_OUTPUT_TOKENS,
            messages=[{"role": "user", "content": full_prompt}]
        )
        result = {
            "model": "GPT 5.4",
            "response": response.choices[0].message.content,
            "status": "success"
        }
        if was_truncated:
            result["warning"] = "Context was truncated to fit within the token limit."
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
