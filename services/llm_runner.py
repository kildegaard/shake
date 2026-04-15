import os
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import anthropic
import openai
import google.generativeai as genai


def _build_full_prompt(prompt_text: str, context_files: list[dict] = None) -> str:
    full = prompt_text
    if context_files:
        full += "\n\n---\n\n## Attached Context Files\n"
        for f in context_files:
            full += f"\n### {f['name']}\n\n{f['content']}\n"
    return full


def run_opus(prompt_text: str, context_files: list[dict] = None) -> dict:
    try:
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        full_prompt = _build_full_prompt(prompt_text, context_files)

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
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
        full_prompt = _build_full_prompt(prompt_text, context_files)

        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=8192,
            messages=[{"role": "user", "content": full_prompt}]
        )
        return {
            "model": "GPT 5.4",
            "response": response.choices[0].message.content,
            "status": "success"
        }
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
