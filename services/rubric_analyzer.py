import os
import json
import re
from services.llm_caller import call_llm, DEFAULT_MODELS

SYSTEM_PROMPT = """You are an expert rubric evaluator for the Jupiter Shake crisis management task design project. Your job is to analyze rubrics written by an Expert and evaluate their quality against the official Rubric Design Guidelines.

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
Be rigorous. A rubric that says 'Explains why X happens' should be flagged as non-binary. A rubric that says 'Mentions X and Y' should be flagged as non-atomic."""


def _preprocess_rubric_text(raw_text: str) -> str:
    """Normalize pasted rubric text into a clean format the LLM can parse.

    Handles the common paste format from Google Docs tables:
      [10] Identifies that plant-wide evacuation is immediately required.
      Sources: Prompt Scenario
    Lines may have inconsistent whitespace or blank lines between entries.
    """
    lines = raw_text.strip().splitlines()
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            cleaned.append("")
            continue
        if re.match(r"^\[\d+\]", stripped):
            cleaned.append(stripped)
        elif re.match(r"^Sources?:", stripped, re.IGNORECASE):
            cleaned.append(stripped)
        else:
            if cleaned and re.match(r"^\[\d+\]", cleaned[-1]):
                cleaned[-1] += " " + stripped
            else:
                cleaned.append(stripped)
    return "\n".join(cleaned)


def analyze_rubrics(rubric_text: str, prompt_text: str, model: str = None) -> dict:
    model = model or DEFAULT_MODELS["rubric"]

    processed_rubrics = _preprocess_rubric_text(rubric_text)
    user_message = f"## Prompt (for coverage gap analysis)\n\n{prompt_text}\n\n## Rubrics to Analyze\n\n{processed_rubrics}"

    response_text = call_llm(model, SYSTEM_PROMPT, user_message, max_tokens=8192)

    try:
        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start != -1 and end > start:
            return json.loads(response_text[start:end])
    except json.JSONDecodeError:
        pass

    return {
        "rubric_evaluations": [],
        "coverage_gaps": [],
        "overall_quality": "unknown",
        "overall_feedback": response_text,
        "stats": {"total_rubrics": 0, "pass": 0, "warn": 0, "fail": 0}
    }
