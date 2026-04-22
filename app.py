import os
import re
import uuid
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from PyPDF2 import PdfReader
from docx import Document
from services.prompt_analyzer import analyze_prompt as _analyze_prompt
from services.rubric_analyzer import analyze_rubrics as _analyze_rubrics
from services.llm_runner import run_models as _run_models
from services.rhea_evaluator import evaluate_response as _evaluate_response
from services.llm_caller import AVAILABLE_MODELS, DEFAULT_MODELS
from services.pdf_generator import (
    generate_response_pdf as _generate_pdf,
    generate_all_llm_pdf as _generate_all_llm_pdf,
    generate_rhea_pdf as _generate_rhea_pdf,
    generate_prompt_pdf as _generate_prompt_pdf,
    generate_rubric_pdf as _generate_rubric_pdf,
)

load_dotenv()

app = Flask(__name__)

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
STORE_PATH = os.path.join(os.path.dirname(__file__), "store_data.json")
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
EXPERTS_PATH = os.path.join(DATA_DIR, "experts.json")
_API_KEY_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY"]

os.makedirs(DATA_DIR, exist_ok=True)

# ─── Expert profiles ──────────────────────────────────────────────────────────

experts_meta = {
    "experts": [],          # list[{id, name, created_at}]
    "active_expert_id": None,
}


def _expert_store_path(expert_id: str) -> str:
    return os.path.join(DATA_DIR, f"expert_{expert_id}.json")


def load_experts():
    if not os.path.exists(EXPERTS_PATH):
        return
    try:
        with open(EXPERTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        experts_meta["experts"] = data.get("experts", [])
        experts_meta["active_expert_id"] = data.get("active_expert_id")
    except Exception as e:
        print(f"[experts] Warning: could not load experts — {e}")


def save_experts():
    try:
        with open(EXPERTS_PATH, "w", encoding="utf-8") as f:
            json.dump(experts_meta, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[experts] Warning: could not save experts — {e}")


def _active_expert_id() -> str | None:
    return experts_meta.get("active_expert_id")


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
    "analysis_models": dict(DEFAULT_MODELS),
    "llm_runs": {},       # model_key → list[{run_id, ts, model, status, response, error, warning}]
    "prompt_runs": [],    # list[{run_id, ts, result}]
    "rubric_runs": [],    # list[{run_id, ts, result}]
    "rhea_runs": [],      # list[{run_id, ts, model_key, llm_run_id, model_name, result}]
}


def _ts() -> str:
    return datetime.now().strftime("%b %d, %H:%M")


def _next_run_id(run_list: list) -> int:
    if not run_list:
        return 1
    return max(r["run_id"] for r in run_list) + 1


def _store_snapshot() -> dict:
    return {
        "prompt_text": store["prompt_text"],
        "context_files": store["context_files"],
        "rubric_text": store["rubric_text"],
        "analysis_models": store["analysis_models"],
        "llm_runs": store["llm_runs"],
        "prompt_runs": store["prompt_runs"],
        "rubric_runs": store["rubric_runs"],
        "rhea_runs": store["rhea_runs"],
    }


def save_store():
    data = _store_snapshot()
    expert_id = _active_expert_id()
    path = _expert_store_path(expert_id) if expert_id else STORE_PATH
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[store] Warning: could not save store — {e}")


def _reset_store():
    store["prompt_text"] = ""
    store["context_files"] = []
    store["rubric_text"] = ""
    store["analysis_models"] = dict(DEFAULT_MODELS)
    store["llm_runs"] = {}
    store["prompt_runs"] = []
    store["rubric_runs"] = []
    store["rhea_runs"] = []


def _apply_store_data(data: dict):
    store["prompt_text"] = data.get("prompt_text", "")
    store["context_files"] = data.get("context_files", [])
    store["rubric_text"] = data.get("rubric_text", "")
    stored_models = data.get("analysis_models", {})
    store["analysis_models"] = dict(DEFAULT_MODELS)
    for k, v in stored_models.items():
        if k in DEFAULT_MODELS and v in AVAILABLE_MODELS:
            store["analysis_models"][k] = v
    store["llm_runs"] = data.get("llm_runs", {})
    store["prompt_runs"] = data.get("prompt_runs", [])
    store["rubric_runs"] = data.get("rubric_runs", [])
    store["rhea_runs"] = data.get("rhea_runs", [])


def load_store():
    expert_id = _active_expert_id()
    path = _expert_store_path(expert_id) if expert_id else STORE_PATH
    if not os.path.exists(path):
        # Fall back to legacy store_data.json if expert file doesn't exist yet
        if expert_id and os.path.exists(STORE_PATH):
            path = STORE_PATH
        else:
            return
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        _apply_store_data(data)
    except Exception as e:
        print(f"[store] Warning: could not load store — {e}")


def _status_payload():
    rubric_count = len(re.findall(r'^\[-?\d+\]', store["rubric_text"], re.MULTILINE)) if store["rubric_text"] else 0
    return {
        "prompt_loaded": bool(store["prompt_text"]),
        "prompt_length": len(store["prompt_text"]),
        "prompt_text": store["prompt_text"],
        "context_files_count": len(store["context_files"]),
        "context_file_names": [f["name"] for f in store["context_files"]],
        "rubric_loaded": bool(store["rubric_text"]),
        "rubric_length": len(store["rubric_text"]),
        "rubric_count": rubric_count,
        "rubric_text": store["rubric_text"],
        "llm_runs": store["llm_runs"],
        "prompt_runs": store["prompt_runs"],
        "rubric_runs": store["rubric_runs"],
        "rhea_runs": store["rhea_runs"],
        "experts": experts_meta["experts"],
        "active_expert_id": experts_meta["active_expert_id"],
    }


load_experts()
load_store()


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

    save_store()
    payload = _status_payload()
    payload["status"] = "ok"
    return jsonify(payload)


@app.route("/api/status", methods=["GET"])
def status():
    return jsonify(_status_payload())


@app.route("/api/analyze/prompt", methods=["POST"])
def analyze_prompt():
    if not store["prompt_text"]:
        return jsonify({"error": "No prompt loaded. Please upload a prompt first."}), 400

    try:
        model = store["analysis_models"].get("prompt", DEFAULT_MODELS["prompt"])
        result = _analyze_prompt(store["prompt_text"], store["context_files"] or None, model=model)
        result["_model_used"] = model
        run_id = _next_run_id(store["prompt_runs"])
        store["prompt_runs"].append({"run_id": run_id, "ts": _ts(), "result": result})
        save_store()
        result["run_id"] = run_id
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
        model = store["analysis_models"].get("rubric", DEFAULT_MODELS["rubric"])
        result = _analyze_rubrics(store["rubric_text"], store["prompt_text"], model=model)
        result["_model_used"] = model
        run_id = _next_run_id(store["rubric_runs"])
        store["rubric_runs"].append({"run_id": run_id, "ts": _ts(), "result": result})
        save_store()
        result["run_id"] = run_id
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

    ts = _ts()
    run_ids = {}
    for r in results:
        key = r["model"].lower().replace(" ", "_").replace(".", "")
        if key not in store["llm_runs"]:
            store["llm_runs"][key] = []
        run_id = _next_run_id(store["llm_runs"][key])
        store["llm_runs"][key].append({
            "run_id": run_id,
            "ts": ts,
            "model": r["model"],
            "status": r["status"],
            "response": r.get("response", ""),
            "error": r.get("error", ""),
            "warning": r.get("warning", ""),
        })
        run_ids[key] = run_id

    save_store()
    return jsonify({"results": results, "run_ids": run_ids})


@app.route("/api/rhea/evaluate", methods=["POST"])
def rhea_evaluate():
    if not store["rubric_text"]:
        return jsonify({"error": "No rubrics loaded. Please upload rubrics first."}), 400

    data = request.get_json() or {}
    model_key = data.get("model_key")
    run_id = data.get("run_id")
    custom_response = data.get("custom_response")
    llm_run_id = None

    if custom_response:
        model_response = custom_response
        model_name = "Custom Response"
    elif model_key:
        runs = store["llm_runs"].get(model_key, [])
        if run_id is not None:
            run = next((r for r in runs if r["run_id"] == run_id), None)
        else:
            run = runs[-1] if runs else None
        if not run:
            return jsonify({"error": "LLM run not found. Run models first."}), 400
        if run["status"] != "success":
            return jsonify({"error": f"Model response for {run['model']} has errors."}), 400
        model_response = run["response"]
        model_name = run["model"]
        llm_run_id = run["run_id"]
    else:
        return jsonify({"error": "No model response selected. Provide a model_key or custom_response."}), 400

    try:
        rhea_model = store["analysis_models"].get("rhea", DEFAULT_MODELS["rhea"])
        result = _evaluate_response(model_response, store["rubric_text"], model=rhea_model)
        result["model_name"] = model_name
        result["_model_used"] = rhea_model
        rhea_run_id = _next_run_id(store["rhea_runs"])
        store["rhea_runs"].append({
            "run_id": rhea_run_id,
            "ts": _ts(),
            "model_key": model_key,
            "llm_run_id": llm_run_id,
            "model_name": model_name,
            "result": result,
        })
        save_store()
        result["run_id"] = rhea_run_id
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"Rhea evaluation failed: {e}"}), 500


@app.route("/api/llm/pdf", methods=["POST"])
def download_pdf():
    data = request.get_json() or {}
    model_key = data.get("model_key")
    run_id = data.get("run_id")
    is_raw = data.get("is_raw", False)

    runs = store["llm_runs"].get(model_key, []) if model_key else []
    if run_id is not None:
        run = next((r for r in runs if r["run_id"] == run_id), None)
    else:
        run = runs[-1] if runs else None

    if not run:
        return jsonify({"error": "Model response not found. The server may have restarted — re-run the model."}), 404

    if run["status"] != "success":
        return jsonify({"error": f"Model {run['model']} has errors and cannot be exported."}), 400

    try:
        pdf_bytes = _generate_pdf(run["model"], run["response"], is_raw=is_raw)
        from flask import Response
        safe_name = f"{model_key}_run{run['run_id']}"
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_response.pdf"'},
        )
    except Exception as e:
        return jsonify({"error": f"PDF generation failed: {e}"}), 500


@app.route("/api/llm/pdf/all", methods=["POST"])
def download_all_llm_pdf():
    """Export every LLM run for every model into one combined PDF, ordered by model."""
    MODEL_ORDER = ["gpt_54", "gemini_31_pro", "opus_46"]

    runs_data = []
    for key in MODEL_ORDER:
        model_runs = store["llm_runs"].get(key, [])
        if not model_runs:
            continue
        model_name = model_runs[-1].get("model", key)
        runs_data.append({
            "model_name": model_name,
            "model_key": key,
            "runs": model_runs,
        })

    # Also include any model keys not in MODEL_ORDER (future-proof)
    ordered_keys = set(MODEL_ORDER)
    for key, model_runs in store["llm_runs"].items():
        if key not in ordered_keys and model_runs:
            model_name = model_runs[-1].get("model", key)
            runs_data.append({
                "model_name": model_name,
                "model_key": key,
                "runs": model_runs,
            })

    if not runs_data:
        return jsonify({"error": "No LLM runs found."}), 404

    try:
        pdf_bytes = _generate_all_llm_pdf(runs_data)
        from flask import Response
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="llm_all_responses.pdf"'},
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


@app.route("/api/settings/analysis-models", methods=["GET"])
def get_analysis_models():
    return jsonify({
        "models": store["analysis_models"],
        "available": {k: v["name"] for k, v in AVAILABLE_MODELS.items()},
        "defaults": DEFAULT_MODELS,
    })


@app.route("/api/settings/analysis-models", methods=["POST"])
def save_analysis_models():
    data = request.get_json() or {}
    updated = []
    for task in ["prompt", "rubric", "rhea"]:
        model_id = data.get(task, "").strip()
        if model_id and model_id in AVAILABLE_MODELS:
            store["analysis_models"][task] = model_id
            updated.append(task)
    save_store()
    return jsonify({"status": "ok", "updated": updated, "models": store["analysis_models"]})


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


@app.route("/api/settings/keys/<key_name>", methods=["DELETE"])
def delete_api_key(key_name):
    if key_name not in _API_KEY_NAMES:
        return jsonify({"error": "Unknown key name"}), 400
    env = _read_env_file()
    env.pop(key_name, None)
    os.environ.pop(key_name, None)
    _write_env_file(env)
    result = {}
    for key in _API_KEY_NAMES:
        value = os.environ.get(key, "")
        result[key] = {"set": bool(value), "masked": _mask_key(value)}
    return jsonify({"status": "ok", "keys": result})


@app.route("/api/settings/keys/all", methods=["DELETE"])
def delete_all_api_keys():
    env = _read_env_file()
    for key in _API_KEY_NAMES:
        env.pop(key, None)
        os.environ.pop(key, None)
    _write_env_file(env)
    result = {key: {"set": False, "masked": ""} for key in _API_KEY_NAMES}
    return jsonify({"status": "ok", "keys": result})


@app.route("/api/runs/llm/<model_key>/<int:run_id>", methods=["DELETE"])
def delete_llm_run(model_key, run_id):
    store["llm_runs"][model_key] = [r for r in store["llm_runs"].get(model_key, []) if r["run_id"] != run_id]
    if not store["llm_runs"].get(model_key):
        store["llm_runs"].pop(model_key, None)
    save_store()
    return jsonify({"status": "ok"})


@app.route("/api/runs/prompt/<int:run_id>", methods=["DELETE"])
def delete_prompt_run(run_id):
    store["prompt_runs"] = [r for r in store["prompt_runs"] if r["run_id"] != run_id]
    save_store()
    return jsonify({"status": "ok"})


@app.route("/api/runs/rubric/<int:run_id>", methods=["DELETE"])
def delete_rubric_run(run_id):
    store["rubric_runs"] = [r for r in store["rubric_runs"] if r["run_id"] != run_id]
    save_store()
    return jsonify({"status": "ok"})


@app.route("/api/runs/rhea/<int:run_id>", methods=["DELETE"])
def delete_rhea_run(run_id):
    store["rhea_runs"] = [r for r in store["rhea_runs"] if r["run_id"] != run_id]
    save_store()
    return jsonify({"status": "ok"})


@app.route("/api/clear", methods=["POST"])
def clear():
    store["prompt_text"] = ""
    store["context_files"] = []
    store["rubric_text"] = ""
    store["llm_runs"] = {}
    store["prompt_runs"] = []
    store["rubric_runs"] = []
    store["rhea_runs"] = []
    save_store()
    return jsonify({"status": "cleared"})


@app.route("/api/clear/prompt", methods=["DELETE"])
def clear_prompt():
    store["prompt_text"] = ""
    save_store()
    return jsonify(_status_payload())


@app.route("/api/clear/rubrics", methods=["DELETE"])
def clear_rubrics():
    store["rubric_text"] = ""
    save_store()
    return jsonify(_status_payload())


@app.route("/api/clear/context", methods=["DELETE"])
def clear_context_all():
    store["context_files"] = []
    save_store()
    return jsonify(_status_payload())


@app.route("/api/clear/context/<path:filename>", methods=["DELETE"])
def clear_context_file(filename):
    store["context_files"] = [f for f in store["context_files"] if f["name"] != filename]
    save_store()
    return jsonify(_status_payload())


# ─── Expert Profiles Routes ───────────────────────────────────────────────────


def _experts_payload():
    return {
        "experts": experts_meta["experts"],
        "active_expert_id": experts_meta["active_expert_id"],
    }


@app.route("/api/experts", methods=["GET"])
def experts_list():
    return jsonify(_experts_payload())


@app.route("/api/experts", methods=["POST"])
def experts_create():
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    expert_id = str(uuid.uuid4())
    expert = {
        "id": expert_id,
        "name": name,
        "created_at": datetime.now().isoformat(),
    }
    experts_meta["experts"].append(expert)
    save_experts()
    return jsonify(expert), 201


@app.route("/api/experts/<expert_id>", methods=["PUT"])
def experts_update(expert_id):
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    expert = next((e for e in experts_meta["experts"] if e["id"] == expert_id), None)
    if not expert:
        return jsonify({"error": "Expert not found"}), 404
    expert["name"] = name
    save_experts()
    return jsonify(expert)


@app.route("/api/experts/<expert_id>", methods=["DELETE"])
def experts_delete(expert_id):
    expert = next((e for e in experts_meta["experts"] if e["id"] == expert_id), None)
    if not expert:
        return jsonify({"error": "Expert not found"}), 404
    experts_meta["experts"] = [e for e in experts_meta["experts"] if e["id"] != expert_id]
    # Remove expert data file if it exists
    ep = _expert_store_path(expert_id)
    if os.path.exists(ep):
        try:
            os.remove(ep)
        except Exception:
            pass
    # If deleted expert was active, switch to another or clear
    if experts_meta["active_expert_id"] == expert_id:
        if experts_meta["experts"]:
            new_active = experts_meta["experts"][0]["id"]
            experts_meta["active_expert_id"] = new_active
            save_experts()
            _reset_store()
            _load_expert_store(new_active)
        else:
            experts_meta["active_expert_id"] = None
            save_experts()
            _reset_store()
    else:
        save_experts()
    return jsonify(_experts_payload())


@app.route("/api/experts/<expert_id>/select", methods=["POST"])
def experts_select(expert_id):
    expert = next((e for e in experts_meta["experts"] if e["id"] == expert_id), None)
    if not expert:
        return jsonify({"error": "Expert not found"}), 404
    # Save current expert's data before switching
    current_id = experts_meta["active_expert_id"]
    if current_id:
        save_store()
    # Switch active expert
    experts_meta["active_expert_id"] = expert_id
    save_experts()
    # Load new expert's data
    _reset_store()
    _load_expert_store(expert_id)
    payload = _status_payload()
    payload["experts"] = experts_meta["experts"]
    payload["active_expert_id"] = expert_id
    return jsonify(payload)


def _load_expert_store(expert_id: str):
    path = _expert_store_path(expert_id)
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        _apply_store_data(data)
    except Exception as e:
        print(f"[experts] Warning: could not load expert store — {e}")


# ─── System Prompts Routes ────────────────────────────────────────────────────

import services.system_prompts_store as _sp_store


@app.route("/api/system-prompts", methods=["GET"])
def sp_get_all():
    return jsonify(_sp_store.get_all())


@app.route("/api/system-prompts/<service_key>", methods=["POST"])
def sp_create(service_key):
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    content = body.get("content", "")
    if not name:
        return jsonify({"error": "Name is required"}), 400
    try:
        prompt = _sp_store.create_prompt(service_key, name, content)
        return jsonify(prompt), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/system-prompts/<service_key>/<prompt_id>", methods=["PUT"])
def sp_update(service_key, prompt_id):
    body = request.get_json(force=True)
    try:
        prompt = _sp_store.update_prompt(
            service_key,
            prompt_id,
            name=body.get("name"),
            content=body.get("content"),
        )
        return jsonify(prompt)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/system-prompts/<service_key>/<prompt_id>", methods=["DELETE"])
def sp_delete(service_key, prompt_id):
    try:
        _sp_store.delete_prompt(service_key, prompt_id)
        return jsonify({"status": "deleted"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/system-prompts/<service_key>/<prompt_id>/activate", methods=["POST"])
def sp_activate(service_key, prompt_id):
    try:
        _sp_store.activate_prompt(service_key, prompt_id)
        return jsonify({"status": "activated"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/system-prompts/<service_key>/reset-default", methods=["POST"])
def sp_reset_default(service_key):
    try:
        _sp_store.reset_to_default(service_key)
        return jsonify({"status": "reset"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=True, reloader_type="stat")
