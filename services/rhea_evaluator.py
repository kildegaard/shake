import os
import json
import re
from services.llm_caller import call_llm, DEFAULT_MODELS

RHEA_SYSTEM_PROMPT = """{
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
}"""


def parse_rubrics_to_criteria(rubric_text: str) -> list[dict]:
    """
    Parse rubric text into criteria dicts with point values.
    Uses stateful parsing identical to the JS parseRubrics() function:
      - Lines starting with [N] or [-N] open a new rubric entry.
      - Lines starting with Source:/Sources: are metadata — skipped.
      - Any other line after an open entry is a continuation of its text.
    This prevents stray source/section labels from being treated as criteria.
    """
    lines = rubric_text.strip().split("\n")
    criteria = []
    current = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Skip source / section attribution lines
        if re.match(r'^sources?:', stripped, re.IGNORECASE):
            continue
        # New rubric entry: [N] or [-N]
        match = re.match(r'^\[(-?\d+)\]\s+(.*)', stripped)
        if match:
            if current:
                criteria.append(current)
            current = {
                "criteria": match.group(2).strip(),
                "points": int(match.group(1)),
            }
        elif current:
            # Continuation line — append to the current criterion text
            current["criteria"] += " " + stripped

    if current:
        criteria.append(current)

    return criteria


def evaluate_response(model_response: str, rubric_text: str, model: str = None) -> dict:
    model = model or DEFAULT_MODELS["rhea"]

    criteria_list = parse_rubrics_to_criteria(rubric_text)
    points_map = {c["criteria"]: c["points"] for c in criteria_list}
    llm_criteria = [{"criteria": c["criteria"]} for c in criteria_list]

    user_message = json.dumps({
        "rubric_response": llm_criteria,
        "model_response": model_response
    }, indent=2)

    response_text = call_llm(model, RHEA_SYSTEM_PROMPT, user_message, max_tokens=8192)

    try:
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start != -1 and end > start:
            result = json.loads(response_text[start:end])
            evaluations = result.get("evaluations", [])

            # Attach point values back to each evaluation result
            for ev in evaluations:
                ev["points"] = points_map.get(ev.get("criteria", ""), 0)

            total = len(evaluations)
            passed = sum(1 for e in evaluations if e.get("status") == "PASS")
            failed = total - passed

            # Scoring rules:
            #   Positive rubric [N]  → PASS = +N pts,  FAIL =  0 pts
            #   Negative rubric [-N] → PASS = -N pts (penalty), FAIL = 0 pts
            # In both cases: effective contribution = PASS ? pts : 0
            scored_points = 0
            penalty_points = 0
            for ev in evaluations:
                pts = ev["points"]
                if ev.get("status") == "PASS":
                    scored_points += pts
                    if pts < 0:
                        penalty_points += pts   # track applied penalties separately

            max_points = sum(c["points"] for c in criteria_list if c["points"] > 0)
            penalty_max = sum(c["points"] for c in criteria_list if c["points"] < 0)

            points_rate = round((scored_points / max_points * 100), 1) if max_points > 0 else 0

            result["summary"] = {
                "total": total,
                "passed": passed,
                "failed": failed,
                "pass_rate": round((passed / total * 100), 1) if total > 0 else 0,
                "scored_points": scored_points,
                "max_points": max_points,
                "penalty_points": penalty_points,
                "penalty_max": penalty_max,
                "points_rate": points_rate,
            }
            return result
    except json.JSONDecodeError:
        pass

    return {
        "evaluations": [],
        "summary": {
            "total": 0, "passed": 0, "failed": 0, "pass_rate": 0,
            "scored_points": 0, "max_points": 0, "points_rate": 0
        },
        "raw_response": response_text
    }
