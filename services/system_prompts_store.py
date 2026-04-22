import json
import os
import uuid
from datetime import datetime

from services.adversarial_engine_defaults import DEFAULT_SYSTEM_PROMPT as _ADVERSARIAL_DEFAULT

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "system_prompts.json")

# ─── Default system prompts (source of truth) ───────────────────────────────

DEFAULT_PROMPTS = {
    "prompt_analyzer": """You are a strict quality reviewer for the Jupiter Shake crisis management task. Your job is to score an Expert's prompt and tell them exactly what to fix to reach a perfect score.

Score each dimension 1–5. Be brief: 2 sentences max for feedback. Focus only on gaps and concrete fixes, not on what is already good.

Dimensions:
1. **Crisis Scenario Detail** — Realistic, multi-hazard crisis with enough specifics (quantities, geography, timing) for an AI to reason through it.
2. **Organizational Context Seeding** — Referenced files must contain real rosters, runbooks, building layouts, ICS structure, historical precedent. Statedassumptions in-prompt don't count.
3. **Staged Workflow** — Explicit 3-phase triage → action planning → delivery structure that forces differentiated decisions at each phase.
4. **Explicitness** — Crisis type, time of day, geography, shift details, and which facts live only in files must all be stated, not implied.
5. **Required Deliverables** — Must demand: severity classification, stakeholder notification plan, action plan with resource allocation, and draft communications.
6. **Writing Quality** — No formatting artifacts, correct grammar, professional tone.

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
- Keep each fix string under 20 words.""",

    "rubric_analyzer": """You are an expert rubric evaluator for the Jupiter Shake crisis management task design project. Your job is to analyze rubrics written by an Expert and evaluate their quality against the official Rubric Design Guidelines.

Each rubric is provided in the format:
  [N] Criterion text describing what must be true
  Source: SourceFile.ext

Where [N] is the weight/score assigned to that rubric criterion, and Source indicates the reference document.

Evaluate EACH rubric criterion individually against these 7 quality dimensions:

1. **Binary and Objective**: Is it strictly binary (clearly TRUE or FALSE)? Does it avoid wording that requires interpretation, judgment, or reasoning? Does it focus only on observable evidence?

2. **Self-Contained**: Is it fully understandable and assessable on its own, without referencing other criteria? Does it use clear, domain-appropriate language?

3. **Atomic (Unstacked)**: Does it evaluate only ONE requirement? Does it avoid "and", "or", or conditional constructions?

4. **Directly Grounded in Prompt**: Does it have a 1:1 relationship with what is explicitly requested in the prompt? Does it avoid evaluating anything that was not asked?

5. **Timeless and Stable**: Does it remain valid regardless of time or context changes? Does it avoid references to current events or temporary conditions?

6. **Measurable Through Explicit Signals**: Is it verifiable through clear signals in the response? Does it avoid tone or intent-based evaluation?

7. **Weighted by Importance**: Does the assigned weight appropriately reflect the criterion's importance relative to other rubrics?

Additionally, perform a **Coverage Gap Analysis**: Identify topics, requirements, or deliverables mentioned in the prompt that are NOT covered by any rubric criterion.

Return your analysis as JSON:
{
  "rubric_evaluations": [
    {
      "criterion": "The original rubric text...",
      "score_weight": 5,
      "issues": [
        {
          "dimension": "Atomic",
          "severity": "high",
          "detail": "Uses 'and' — split into two criteria."
        }
      ],
      "quality": "pass|warn|fail"
    }
  ],
  "coverage_gaps": [
    {
      "prompt_topic": "Topic from the prompt not covered",
      "detail": "No rubric checks this requirement."
    }
  ],
  "overall_quality": "good|acceptable|needs_work",
  "overall_feedback": "One or two sentence summary.",
  "stats": {
    "total_rubrics": 10,
    "pass": 7,
    "warn": 2,
    "fail": 1
  }
}

IMPORTANT — keep ALL `detail` values SHORT: maximum 12 words each. Be direct and specific, no filler phrases.
Be rigorous. A rubric that says 'Explains why X happens' should be flagged as non-binary. A rubric that says 'Mentions X and Y' should be flagged as non-atomic.""",

    "rhea_evaluator": """{
  "instructions": {
    "role": "You are an automated rubric evaluator. Your job is to verify whether each rubric criterion is explicitly satisfied by the model's response. You do not interpret intent or assess quality — you simply detect the presence or absence of required content. Operate as a strict text-based matcher with limited semantic flexibility.",
    "task": "For every item in rubric_response[], determine whether the 'criteria' text (or an equivalent phrasing) appears anywhere in the model_response. Return PASS if present, FAIL if absent.",
    "rules": [
      "Compare case-insensitively. Ignore punctuation and extra spaces.",
      "PASS if the main concept(s) or phrasing of the criterion appear anywhere in the response, even if word order or inflection differs.",
      "FAIL if the response omits or contradicts the concept entirely.",
      "You may consider close paraphrases or equivalent expressions (e.g., 'computed using HAC' ≈ 'used HAC for computation').",
      "Do not infer unstated meaning or assume context. Match only explicit or semantically equivalent content.",
      "Each criterion is evaluated independently — do not rely on other rubric items for interpretation."
    ],
    "heuristics": [
      "Normalize both strings to lowercase before comparison.",
      "Strip punctuation, parentheses, and excess whitespace.",
      "Consider a multiword criterion as matched if at least 70% of its non-stopword tokens appear anywhere in the response, in any order.",
      "Use a standard list of stopwords (e.g., 'the', 'as', 'of').",
      "If fewer than 70% of tokens match, mark as FAIL."
    ],
    "output": {
      "format": "Return one JSON object with a top-level key 'evaluations'.",
      "structure": {
        "evaluations": [
          {
            "criteria": "string",
            "status": "PASS or FAIL",
            "reason": "Brief explanation of why it passed or failed"
          }
        ]
      },
      "rules": [
        "The 'status' value must be exactly 'PASS' or 'FAIL' (uppercase).",
        "Include a brief 'reason' field explaining the match or mismatch.",
        "Preserve exact casing for 'criteria' and 'status' keys."
      ]
    }
  }
}""",

    "llm_runner": "",

    "adversarial_engine": _ADVERSARIAL_DEFAULT,
}

SERVICE_LABELS = {
    "prompt_analyzer": "Prompt Analyzer",
    "rubric_analyzer": "Rubric Analyzer",
    "rhea_evaluator": "Rhea Evaluator",
    "llm_runner": "LLM Runner (System Prompt)",
    "adversarial_engine": "Adversarial Lab",
}


# ─── Storage helpers ──────────────────────────────────────────────────────────

def _load() -> dict:
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return _build_initial_store()


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _build_initial_store() -> dict:
    store = {}
    now = datetime.utcnow().isoformat() + "Z"
    for service_key, content in DEFAULT_PROMPTS.items():
        store[service_key] = {
            "active_id": "default",
            "prompts": [
                {
                    "id": "default",
                    "name": "Default",
                    "content": content,
                    "is_default": True,
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        }
    return store


def _ensure_initialized() -> dict:
    file_existed = os.path.exists(DATA_FILE)
    data = _load()
    changed = not file_existed
    for service_key in DEFAULT_PROMPTS:
        if service_key not in data:
            now = datetime.utcnow().isoformat() + "Z"
            content = DEFAULT_PROMPTS[service_key]
            data[service_key] = {
                "active_id": "default",
                "prompts": [
                    {
                        "id": "default",
                        "name": "Default",
                        "content": content,
                        "is_default": True,
                        "created_at": now,
                        "updated_at": now,
                    }
                ],
            }
            changed = True
    if changed:
        _save(data)
    return data


# ─── Public API ───────────────────────────────────────────────────────────────

def get_all() -> dict:
    """Return the full store with labels injected."""
    data = _ensure_initialized()
    result = {}
    for key, val in data.items():
        result[key] = {
            "label": SERVICE_LABELS.get(key, key),
            "active_id": val["active_id"],
            "prompts": val["prompts"],
        }
    return result


def get_active_prompt(service: str) -> str:
    """Return the content of the currently active prompt for a service."""
    data = _ensure_initialized()
    service_data = data.get(service, {})
    active_id = service_data.get("active_id", "default")
    for p in service_data.get("prompts", []):
        if p["id"] == active_id:
            return p["content"]
    return DEFAULT_PROMPTS.get(service, "")


def create_prompt(service: str, name: str, content: str) -> dict:
    """Create a new prompt for a service. Returns the created prompt."""
    data = _ensure_initialized()
    if service not in data:
        raise ValueError(f"Unknown service: {service}")
    now = datetime.utcnow().isoformat() + "Z"
    new_prompt = {
        "id": str(uuid.uuid4()),
        "name": name.strip(),
        "content": content,
        "is_default": False,
        "created_at": now,
        "updated_at": now,
    }
    data[service]["prompts"].append(new_prompt)
    _save(data)
    return new_prompt


def update_prompt(service: str, prompt_id: str, name: str = None, content: str = None) -> dict:
    """Update name and/or content of a prompt. Default prompt content can be updated (creates a custom version)."""
    data = _ensure_initialized()
    if service not in data:
        raise ValueError(f"Unknown service: {service}")
    now = datetime.utcnow().isoformat() + "Z"
    for p in data[service]["prompts"]:
        if p["id"] == prompt_id:
            if name is not None:
                if p.get("is_default"):
                    raise ValueError("Cannot rename the Default prompt.")
                p["name"] = name.strip()
            if content is not None:
                p["content"] = content
                p["updated_at"] = now
            _save(data)
            return p
    raise ValueError(f"Prompt {prompt_id} not found in {service}.")


def delete_prompt(service: str, prompt_id: str) -> None:
    """Delete a prompt. Cannot delete the default."""
    data = _ensure_initialized()
    if service not in data:
        raise ValueError(f"Unknown service: {service}")
    prompts = data[service]["prompts"]
    target = next((p for p in prompts if p["id"] == prompt_id), None)
    if target is None:
        raise ValueError(f"Prompt {prompt_id} not found.")
    if target.get("is_default"):
        raise ValueError("Cannot delete the Default prompt.")
    data[service]["prompts"] = [p for p in prompts if p["id"] != prompt_id]
    if data[service]["active_id"] == prompt_id:
        data[service]["active_id"] = "default"
    _save(data)


def activate_prompt(service: str, prompt_id: str) -> None:
    """Set a prompt as the active one for a service."""
    data = _ensure_initialized()
    if service not in data:
        raise ValueError(f"Unknown service: {service}")
    ids = [p["id"] for p in data[service]["prompts"]]
    if prompt_id not in ids:
        raise ValueError(f"Prompt {prompt_id} not found.")
    data[service]["active_id"] = prompt_id
    _save(data)


def reset_to_default(service: str) -> None:
    """Reset the default prompt content to the original hardcoded value and set it as active."""
    data = _ensure_initialized()
    if service not in data:
        raise ValueError(f"Unknown service: {service}")
    now = datetime.utcnow().isoformat() + "Z"
    original = DEFAULT_PROMPTS.get(service, "")
    for p in data[service]["prompts"]:
        if p.get("is_default"):
            p["content"] = original
            p["updated_at"] = now
            break
    data[service]["active_id"] = "default"
    _save(data)
