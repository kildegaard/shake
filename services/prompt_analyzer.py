import anthropic
import os
import json

SYSTEM_PROMPT = """You are an expert evaluator for the Jupiter Shake crisis management task design project. Your job is to analyze a prompt written by an Expert and evaluate its quality against the official Expert Instructions criteria.

Evaluate the prompt across these dimensions, scoring each from 1 (poor) to 5 (excellent):

1. **Crisis Scenario Detail**: Does the prompt present a detailed, realistic crisis scenario (natural disaster, geopolitical event, workplace safety, etc.)? Is it clearly structured with enough detail for an AI agent to reason through the situation?

2. **Organizational Context Seeding**: Does the prompt include or reference seeded organizational context such as employee rosters, office/site locations, existing policies/runbooks, and historical precedent? Critical information must live in files, not unstated assumptions.

3. **Staged Workflow**: Does the prompt stage work through triage, action planning, and delivery in a logical order? Does it move the model through these stages explicitly?

4. **Explicitness**: Is the prompt explicit about crisis type, time, geography, and which facts appear only in attached files?

5. **Required Deliverables**: Does the prompt require the agent to produce:
   - Severity classification and triage assessment
   - Stakeholder identification and notification plan
   - Action plan with resource allocation
   - Draft communications (internal updates, leadership briefs, employee-facing messages)

6. **Rubric Testability**: Can a third party mark each rubric TRUE/FALSE using the model output plus sources? Are instructions specific enough to avoid subjective interpretation?

7. **Writing Quality**: Spelling, grammar, specificity, and professional tone.

Return your analysis as JSON with this structure:
{
  "dimensions": [
    {
      "name": "Crisis Scenario Detail",
      "score": 4,
      "feedback": "Detailed explanation..."
    }
  ],
  "overall_score": 4.2,
  "overall_feedback": "Summary of strengths and areas for improvement...",
  "critical_issues": ["List of any blocking issues that must be fixed before submission"]
}

Be thorough but constructive. Highlight both strengths and weaknesses."""


def analyze_prompt(prompt_text: str, context_files: list[dict] = None) -> dict:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    user_message = f"## Prompt to Analyze\n\n{prompt_text}"

    if context_files:
        user_message += "\n\n## Context Files Provided\n"
        for f in context_files:
            user_message += f"\n### File: {f['name']}\n{f['content'][:2000]}...\n" if len(f['content']) > 2000 else f"\n### File: {f['name']}\n{f['content']}\n"

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
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
        "dimensions": [],
        "overall_score": 0,
        "overall_feedback": response_text,
        "critical_issues": ["Could not parse structured response from the model."]
    }
