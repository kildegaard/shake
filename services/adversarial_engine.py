"""
Adversarial Lab: suggest hardened rubrics and prompt modifications so frontier models
fail a high fraction of Rhea-style rubric checks (target ≥60% FAIL rate).
"""
import anthropic
import json
import os
import re

from services.adversarial_engine_defaults import DEFAULT_SYSTEM_PROMPT


def _unwrap_markdown_code_fence(text: str) -> str:
    """If the model wrapped JSON in ```json ... ```, extract the inner body."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*\n?", t)
    if not m:
        return t
    start = m.end()
    close = t.find("```", start)
    if close == -1:
        return t[start:].strip()
    return t[start:close].strip()


def _first_balanced_json_object(text: str) -> str | None:
    """Extract one top-level JSON object using brace depth, respecting string literals."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    i = start
    n = len(text)
    in_string = False
    escape = False
    while i < n:
        c = text[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        i += 1
    return None


def _parse_model_json_response(response_text: str) -> dict | None:
    """Strip fences, extract balanced `{...}`, parse JSON."""
    cleaned = _unwrap_markdown_code_fence(response_text)
    candidate = _first_balanced_json_object(cleaned)
    if candidate is None:
        candidate = cleaned.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    # Fallback: substring from first { to last } (legacy behavior)
    try:
        s = cleaned.find("{")
        e = cleaned.rfind("}") + 1
        if s != -1 and e > s:
            return json.loads(cleaned[s:e])
    except json.JSONDecodeError:
        pass
    return None


def _build_user_content(
    prompt_text: str,
    context_files: list[dict] | None,
    rubric_text: str,
) -> list:
    """Build Anthropic message content; text context snippets capped per file."""
    parts = []
    body = "## Task prompt\n\n" + (prompt_text or "(empty)")

    body += "\n\n## Current rubrics\n\n" + (rubric_text or "(empty)")

    if context_files:
        text_files = [f for f in context_files if f.get("type", "text") == "text"]
        image_files = [f for f in context_files if f.get("type") == "image"]
        if text_files:
            body += "\n\n## Context file excerpts (truncated)\n"
            for f in text_files:
                c = f.get("content") or ""
                snippet = c[:4000] + "..." if len(c) > 4000 else c
                body += f"\n### {f.get('name', 'file')}\n{snippet}\n"
        if image_files:
            body += "\n\n(Note: " + str(len(image_files)) + " image file(s) are attached; criteria may require visual details from them.)"
        parts.append({"type": "text", "text": body})
        for f in image_files:
            parts.append({"type": "text", "text": f"\n### Image: {f.get('name', 'image')}\n"})
            parts.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": f.get("media_type", "image/png"),
                    "data": f.get("data", ""),
                },
            })
        return parts

    parts.append({"type": "text", "text": body})
    return parts


def analyze(
    prompt_text: str,
    context_files: list[dict] | None,
    rubric_text: str,
    rhea_results: dict | None = None,
    system_prompt: str | None = None,
) -> dict:
    """
    Call Claude to produce hardened rubrics and related suggestions.

    rhea_results: optional dict keyed by model_key, each value is the JSON
    returned from Rhea (evaluations, summary, etc.) — same shape as frontend appState.rheaResults.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    active_system = system_prompt if system_prompt is not None else DEFAULT_SYSTEM_PROMPT

    extra = ""
    if rhea_results:
        try:
            extra = "\n\n## Past Rhea results (JSON)\n\n```json\n"
            extra += json.dumps(rhea_results, ensure_ascii=False, indent=2)[:120000]
            extra += "\n```\n\nUse these to label criteria that every model passed as too easy."
        except (TypeError, ValueError):
            extra = ""

    base = _build_user_content(prompt_text, context_files, rubric_text)
    if extra and base:
        if base[0].get("type") == "text":
            base[0]["text"] = base[0]["text"] + extra
        else:
            base.insert(0, {"type": "text", "text": extra.strip()})

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        system=active_system,
        messages=[{"role": "user", "content": base}],
    )

    response_text = response.content[0].text

    parsed = _parse_model_json_response(response_text)
    if parsed is not None:
        return parsed

    return {
        "weakness_analysis": "",
        "too_easy_criteria": [],
        "hardened_rubrics": "",
        "prompt_modifications": [],
        "context_trap_ideas": [],
        "estimated_fail_rate": "",
        "strategies_used": [],
        "error": "The model did not return parseable JSON.",
        "raw_response": response_text,
    }
