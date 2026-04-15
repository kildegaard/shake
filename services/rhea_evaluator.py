import anthropic
import os
import json

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
    lines = rubric_text.strip().split("\n")
    criteria = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        cleaned = line.lstrip("0123456789.-•) ").strip()
        if cleaned:
            criteria.append({"criteria": cleaned})
    return criteria


def evaluate_response(model_response: str, rubric_text: str) -> dict:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    criteria_list = parse_rubrics_to_criteria(rubric_text)

    user_message = json.dumps({
        "rubric_response": criteria_list,
        "model_response": model_response
    }, indent=2)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8192,
        system=RHEA_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}]
    )

    response_text = response.content[0].text

    try:
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start != -1 and end > start:
            result = json.loads(response_text[start:end])
            evaluations = result.get("evaluations", [])
            total = len(evaluations)
            passed = sum(1 for e in evaluations if e.get("status") == "PASS")
            failed = total - passed
            result["summary"] = {
                "total": total,
                "passed": passed,
                "failed": failed,
                "pass_rate": round((passed / total * 100), 1) if total > 0 else 0
            }
            return result
    except json.JSONDecodeError:
        pass

    return {
        "evaluations": [],
        "summary": {"total": 0, "passed": 0, "failed": 0, "pass_rate": 0},
        "raw_response": response_text
    }
