# Shake Analyzer

A web-based tool for analyzing AI prompts, rubrics, and LLM responses. It lets you upload context documents, run your prompt across multiple language models simultaneously, evaluate results with a structured rubric, and export everything as PDF.

## Features

- **Prompt Analysis** — Get concise, actionable feedback on your prompt's clarity, structure, and potential issues.
- **Rubric Analysis** — Parse and evaluate rubric documents to understand scoring criteria.
- **Multi-Model LLM Testing** — Run your prompt against Claude, GPT, and Gemini side by side.
- **RHEA Evaluation** — Score each model's response against your rubric using a structured evaluator.
- **Adversarial Lab** — Test how your prompt holds up against adversarial inputs.
- **PDF Export** — Download analysis results and LLM responses as formatted PDF files.
- **File Uploads** — Attach `.docx`, `.pdf`, `.xlsx`, and image files as context for your prompt.

## Requirements

- Python 3.10+
- API keys for:
  - [Anthropic](https://console.anthropic.com/) (Claude)
  - [OpenAI](https://platform.openai.com/) (GPT)
  - [Google AI Studio](https://aistudio.google.com/) (Gemini)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/kildegaard/shake.git
cd shake
```

### 2. Create a virtual environment

```bash
python -m venv venv
source venv/bin/activate        # Linux / macOS
venv\Scripts\activate           # Windows
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the app

```bash
python app.py
```

Then open your browser and go to [http://localhost:5000](http://localhost:5000).

### 5. Configure your API keys

No `.env` file needed. Once the app is running, click the **⚙ gear icon** in the top-right corner of the header to open the API Key Settings panel.

Enter your keys for:
- **Anthropic** — used by Prompt Analysis, Rubric Analysis, Rhea Evaluator, and Opus 4.6 in LLM Testing
- **OpenAI** — used by GPT 5.4 in LLM Testing
- **Google AI** — used by Gemini 3.1 Pro in LLM Testing

Click **Save Keys** and they will be written to a local `.env` file on your machine. The dot on the gear icon turns green once all keys are configured. Keys are never sent anywhere — they live only on your machine.

## Project Structure

```
shake_analyzer/
├── app.py                  # Flask application and routes
├── requirements.txt        # Python dependencies
├── services/
│   ├── prompt_analyzer.py          # Prompt feedback logic
│   ├── rubric_analyzer.py          # Rubric parsing and analysis
│   ├── llm_runner.py               # Multi-model LLM runner
│   ├── rhea_evaluator.py           # Response evaluation against rubrics
│   ├── adversarial_engine.py       # Adversarial prompt testing
│   ├── adversarial_engine_defaults.py
│   ├── system_prompts_store.py     # System prompt management
│   └── pdf_generator.py            # PDF export logic
├── templates/
│   └── index.html          # Main UI
├── static/
│   └── css/
│       └── style.css       # Styles
└── uploads/                # Temporary file uploads (gitignored)
```

## Notes

- The `uploads/` folder is created automatically on first run and is excluded from version control.
- API keys are saved locally via the in-app settings panel (gear icon in the header). The generated `.env` file is gitignored and never committed.
- Make sure your API keys have sufficient quota before running batch evaluations.
