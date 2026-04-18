import os
import re
import uuid
from flask import Flask, request, jsonify, render_template, session
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from PyPDF2 import PdfReader
from docx import Document
from services.prompt_analyzer import analyze_prompt as _analyze_prompt
from services.rubric_analyzer import analyze_rubrics as _analyze_rubrics
from services.llm_runner import run_models as _run_models
from services.rhea_evaluator import evaluate_response as _evaluate_response
from services.pdf_generator import (
    generate_response_pdf as _generate_pdf,
    generate_rhea_pdf as _generate_rhea_pdf,
    generate_prompt_pdf as _generate_prompt_pdf,
    generate_rubric_pdf as _generate_rubric_pdf,
)

load_dotenv()

app = Flask(__name__)

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
_API_KEY_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY"]


def _read_env_file() -> dict:
    env = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip()
    return env


def _write_env_file(env: dict):
    lines = [f"{k}={v}" for k, v in env.items()]
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def _mask_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * (len(value) - 8) + value[-4:]
app.secret_key = os.urandom(24)
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(__file__), "uploads")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

store = {
    "prompt_text": "",
    "context_files": [],
    "rubric_text": "",
    "llm_responses": {},
}


def extract_text_from_file(filepath: str, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        try:
            reader = PdfReader(filepath)
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            return f"[Error reading PDF: {e}]"
    elif ext == "docx":
        try:
            doc = Document(filepath)
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            return f"[Error reading DOCX: {e}]"
    else:
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        except Exception as e:
            return f"[Error reading file: {e}]"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    prompt_text = request.form.get("prompt_text", "").strip()
    rubric_text = request.form.get("rubric_text", "").strip()

    if prompt_text:
        store["prompt_text"] = prompt_text

    if rubric_text:
        store["rubric_text"] = rubric_text

    if "prompt_file" in request.files:
        f = request.files["prompt_file"]
        if f.filename:
            filename = secure_filename(f.filename)
            filepath = os.path.join(app.config["UPLOAD_FOLDER"], f"{uuid.uuid4()}_{filename}")
            f.save(filepath)
            store["prompt_text"] = extract_text_from_file(filepath, filename)

    if "rubric_file" in request.files:
        f = request.files["rubric_file"]
        if f.filename:
            filename = secure_filename(f.filename)
            filepath = os.path.join(app.config["UPLOAD_FOLDER"], f"{uuid.uuid4()}_{filename}")
            f.save(filepath)
            store["rubric_text"] = extract_text_from_file(filepath, filename)

    context_files = request.files.getlist("context_files")
    if context_files and context_files[0].filename:
        store["context_files"] = []
        for f in context_files:
            if f.filename:
                filename = secure_filename(f.filename)
                filepath = os.path.join(app.config["UPLOAD_FOLDER"], f"{uuid.uuid4()}_{filename}")
                f.save(filepath)
                content = extract_text_from_file(filepath, filename)
                store["context_files"].append({
                    "name": filename,
                    "content": content
                })

    rubric_count = len(re.findall(r'\[\d+\]', store["rubric_text"])) if store["rubric_text"] else 0
    return jsonify({
        "status": "ok",
        "prompt_loaded": bool(store["prompt_text"]),
        "prompt_length": len(store["prompt_text"]),
        "context_files_count": len(store["context_files"]),
        "context_file_names": [f["name"] for f in store["context_files"]],
        "rubric_loaded": bool(store["rubric_text"]),
        "rubric_length": len(store["rubric_text"]),
        "rubric_count": rubric_count,
    })


@app.route("/api/status", methods=["GET"])
def status():
    rubric_count = len(re.findall(r'\[\d+\]', store["rubric_text"])) if store["rubric_text"] else 0
    return jsonify({
        "prompt_loaded": bool(store["prompt_text"]),
        "prompt_length": len(store["prompt_text"]),
        "prompt_preview": store["prompt_text"][:200] if store["prompt_text"] else "",
        "context_files_count": len(store["context_files"]),
        "context_file_names": [f["name"] for f in store["context_files"]],
        "rubric_loaded": bool(store["rubric_text"]),
        "rubric_length": len(store["rubric_text"]),
        "rubric_count": rubric_count,
        "rubric_preview": store["rubric_text"][:200] if store["rubric_text"] else "",
        "llm_responses": {k: {"model": v["model"], "status": v["status"]} for k, v in store["llm_responses"].items()},
    })


@app.route("/api/analyze/prompt", methods=["POST"])
def analyze_prompt():
    if not store["prompt_text"]:
        return jsonify({"error": "No prompt loaded. Please upload a prompt first."}), 400

    try:
        result = _analyze_prompt(store["prompt_text"], store["context_files"] or None)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"Prompt analysis failed: {e}"}), 500


@app.route("/api/analyze/rubrics", methods=["POST"])
def analyze_rubrics():
    if not store["rubric_text"]:
        return jsonify({"error": "No rubrics loaded. Please upload rubrics first."}), 400
    if not store["prompt_text"]:
        return jsonify({"error": "No prompt loaded. Rubric analysis requires the prompt for coverage gap detection."}), 400

    try:
        result = _analyze_rubrics(store["rubric_text"], store["prompt_text"])
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Rubric analysis failed: {e}"}), 500


@app.route("/api/llm/run", methods=["POST"])
def run_llm():
    if not store["prompt_text"]:
        return jsonify({"error": "No prompt loaded. Please upload a prompt first."}), 400

    data = request.get_json() or {}
    models = data.get("models", ["opus", "gpt", "gemini"])

    results = _run_models(store["prompt_text"], store["context_files"] or None, models)

    for r in results:
        key = r["model"].lower().replace(" ", "_").replace(".", "")
        store["llm_responses"][key] = r

    return jsonify({"results": results})


@app.route("/api/rhea/evaluate", methods=["POST"])
def rhea_evaluate():
    if not store["rubric_text"]:
        return jsonify({"error": "No rubrics loaded. Please upload rubrics first."}), 400

    data = request.get_json() or {}
    model_key = data.get("model_key")
    custom_response = data.get("custom_response")

    if custom_response:
        model_response = custom_response
        model_name = "Custom Response"
    elif model_key and model_key in store["llm_responses"]:
        r = store["llm_responses"][model_key]
        if r["status"] != "success":
            return jsonify({"error": f"Model response for {r['model']} has errors."}), 400
        model_response = r["response"]
        model_name = r["model"]
    else:
        available = list(store["llm_responses"].keys())
        return jsonify({
            "error": "No model response selected. Provide a model_key or custom_response.",
            "available_models": available
        }), 400

    try:
        result = _evaluate_response(model_response, store["rubric_text"])
        result["model_name"] = model_name
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"Rhea evaluation failed: {e}"}), 500


@app.route("/api/llm/pdf", methods=["POST"])
def download_pdf():
    data = request.get_json() or {}
    model_key = data.get("model_key")
    is_raw = data.get("is_raw", False)

    if not model_key or model_key not in store["llm_responses"]:
        return jsonify({"error": "Model response not found."}), 404

    r = store["llm_responses"][model_key]
    if r["status"] != "success":
        return jsonify({"error": f"Model {r['model']} has errors and cannot be exported."}), 400

    try:
        pdf_bytes = _generate_pdf(r["model"], r["response"], is_raw=is_raw)
        from flask import Response
        safe_name = model_key.replace(" ", "_")
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_response.pdf"'},
        )
    except Exception as e:
        return jsonify({"error": f"PDF generation failed: {e}"}), 500


@app.route("/api/rubric/pdf", methods=["POST"])
def download_rubric_pdf():
    data = request.get_json() or {}
    analysis = data.get("analysis", {})

    if not analysis:
        return jsonify({"error": "No analysis data provided."}), 400

    try:
        pdf_bytes = _generate_rubric_pdf(analysis)
        from flask import Response
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="rubric_analysis.pdf"'},
        )
    except Exception as e:
        return jsonify({"error": f"Rubric PDF generation failed: {e}"}), 500


@app.route("/api/prompt/pdf", methods=["POST"])
def download_prompt_pdf():
    data = request.get_json() or {}
    analysis = data.get("analysis", {})

    if not analysis:
        return jsonify({"error": "No analysis data provided."}), 400

    try:
        pdf_bytes = _generate_prompt_pdf(analysis)
        from flask import Response
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="prompt_analysis.pdf"'},
        )
    except Exception as e:
        return jsonify({"error": f"Prompt PDF generation failed: {e}"}), 500


@app.route("/api/rhea/pdf", methods=["POST"])
def download_rhea_pdf():
    data = request.get_json() or {}
    rhea_results = data.get("rhea_results", {})

    if not rhea_results:
        return jsonify({"error": "No Rhea evaluation results provided."}), 400

    try:
        pdf_bytes = _generate_rhea_pdf(rhea_results)
        from flask import Response
        model_keys = "_".join(rhea_results.keys())[:40]
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="rhea_{model_keys}.pdf"'},
        )
    except Exception as e:
        return jsonify({"error": f"Rhea PDF generation failed: {e}"}), 500


@app.route("/api/settings/keys", methods=["GET"])
def get_api_keys():
    result = {}
    for key in _API_KEY_NAMES:
        value = os.environ.get(key, "")
        result[key] = {"set": bool(value), "masked": _mask_key(value)}
    return jsonify(result)


@app.route("/api/settings/keys", methods=["POST"])
def save_api_keys():
    data = request.get_json() or {}
    env = _read_env_file()
    updated = []
    for key in _API_KEY_NAMES:
        value = data.get(key, "").strip()
        if value:
            env[key] = value
            os.environ[key] = value
            updated.append(key)
    _write_env_file(env)
    return jsonify({"status": "ok", "updated": updated})


@app.route("/api/clear", methods=["POST"])
def clear():
    store["prompt_text"] = ""
    store["context_files"] = []
    store["rubric_text"] = ""
    store["llm_responses"] = {}
    return jsonify({"status": "cleared"})


if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=True, reloader_type="stat")
