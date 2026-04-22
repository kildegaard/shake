import os
import json
from services.llm_caller import call_llm, DEFAULT_MODELS

SYSTEM_PROMPT = """You are a strict quality reviewer for the Jupiter Shake crisis management task. Your job is to score an Expert's prompt and tell them exactly what to fix to reach a perfect score.

Score each dimension 1–5. Be brief: 2 sentences max for feedback. Focus only on gaps and concrete fixes, not on what is already good.

Dimensions:
1. **Crisis Scenario Detail** — Realistic, multi-hazard crisis with enough specifics (quantities, geography, timing) for an AI to reason through it.
2. **Organizational Context Seeding** — Referenced files must contain real rosters, runbooks, building layouts, ICS structure, historical precedent. Statedassumptions in-prompt don't count.
3. **Staged Workflow** — Explicit 3-phase triage → action planning → delivery structure that forces differentiated decisions at each phase.
4. **Explicitness** — Crisis type, time of day, geography, shift details, and which facts live only in files must all be stated, not implied.
5. **Required Deliverables** — Must demand: severity classification, stakeholder notification plan, action plan with resource allocation, and draft communications.
6. **Rubric Testability** — Every rubric must be checkable TRUE/FALSE from model output + sources. No subjective or "should include" language.
7. **Writing Quality** — No formatting artifacts, correct grammar, professional tone.

Return ONLY this JSON (no markdown wrapper):
{
  "dimensions": [
    {
      "name": "Crisis Scenario Detail",
      "score": 4,
      "feedback": "One or two sentences on what is missing or weak.",
      "fixes": ["Specific action item 1", "Specific action item 2"]
    }
  ],
  "overall_score": 4.2,
  "overall_feedback": "One sentence: the single biggest blocker keeping this prompt from a perfect score.",
  "critical_issues": ["Any hard blockers that must be resolved before submission — keep to 1-3 items max, omit if none"]
}

Rules:
- fixes[] must be concrete and actionable (e.g. "Add a clock time like 14:30 for shift-change context" not "Be more explicit about time").
- If a dimension scores 5, still add at least one fix noting what would break that score.
- Keep each feedback string under 40 words.
- Keep each fix string under 20 words."""


def analyze_prompt(prompt_text: str, context_files: list[dict] = None, model: str = None) -> dict:
    model = model or DEFAULT_MODELS["prompt"]

    user_message = f"## Prompt to Analyze\n\n{prompt_text}"

    if context_files:
        user_message += "\n\n## Context Files Provided\n"
        for f in context_files:
            user_message += (
                f"\n### File: {f['name']}\n{f['content'][:2000]}...\n"
                if len(f['content']) > 2000
                else f"\n### File: {f['name']}\n{f['content']}\n"
            )

    response_text = call_llm(model, SYSTEM_PROMPT, user_message, max_tokens=2048)

    try:
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start != -1 and end > start:
            return json.loads(response_text[start:end])
    except json.JSONDecodeError:
        pass

    return {
        "dimensions": [],
        "overall_score": 0,
        "overall_feedback": response_text,
        "critical_issues": ["Could not parse structured response from the model."]
    }
