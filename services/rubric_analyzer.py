import anthropic
import os
import json

SYSTEM_PROMPT = """You are an expert rubric evaluator for the Jupiter Shake crisis management task design project. Your job is to analyze rubrics written by an Expert and evaluate their quality against the official Rubric Design Guidelines.

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
          "detail": "Contains 'and' combining two separate checks..."
        }
      ],
      "quality": "pass|warn|fail"
    }
  ],
  "coverage_gaps": [
    {
      "prompt_topic": "Topic from the prompt not covered",
      "detail": "Explanation of what is missing..."
    }
  ],
  "overall_quality": "good|acceptable|needs_work",
  "overall_feedback": "Summary...",
  "stats": {
    "total_rubrics": 10,
    "pass": 7,
    "warn": 2,
    "fail": 1
  }
}

Be rigorous. A rubric that says 'Explains why X happens' should be flagged as non-binary. A rubric that says 'Mentions X and Y' should be flagged as non-atomic."""


def analyze_rubrics(rubric_text: str, prompt_text: str) -> dict:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    user_message = f"## Prompt (for coverage gap analysis)\n\n{prompt_text}\n\n## Rubrics to Analyze\n\n{rubric_text}"

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8192,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}]
    )

    response_text = response.content[0].text

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
