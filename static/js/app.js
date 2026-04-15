// ─── State ───
let appState = {
    promptLoaded: false,
    rubricLoaded: false,
    contextFilesCount: 0,
    llmResponses: {},
    rheaResults: {}
};

// Raw response text stored by modelKey for markdown toggle + PDF
const llmRawResponses = {};

// Markdown toggle state per model tab (true = rendered, false = raw)
const mdToggleState = {};

// Currently active model tab key
let activeModelTab = null;

// ─── Tab Navigation ───
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const target = document.getElementById('tab-' + tabId);
    if (target) target.classList.add('active');

    const btn = document.querySelector(`[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
}

// ─── Loading Overlay ───
function showLoading(text, subtext = '') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-subtext').textContent = subtext;
    document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

// ─── Status Bar ───
function updateStatus(data) {
    const promptEl = document.getElementById('status-prompt');
    const filesEl = document.getElementById('status-files');
    const rubricsEl = document.getElementById('status-rubrics');

    if (data.prompt_loaded) {
        promptEl.textContent = `Prompt: ${data.prompt_length.toLocaleString()} chars`;
        promptEl.className = 'status-pill status-loaded';
        appState.promptLoaded = true;
    } else {
        promptEl.textContent = 'Prompt: Empty';
        promptEl.className = 'status-pill status-empty';
        appState.promptLoaded = false;
    }

    filesEl.textContent = `Files: ${data.context_files_count}`;
    filesEl.className = data.context_files_count > 0 ? 'status-pill status-loaded' : 'status-pill status-empty';
    appState.contextFilesCount = data.context_files_count;

    if (data.rubric_loaded) {
        rubricsEl.textContent = `Rubrics: ${data.rubric_length.toLocaleString()} chars`;
        rubricsEl.className = 'status-pill status-loaded';
        appState.rubricLoaded = true;
    } else {
        rubricsEl.textContent = 'Rubrics: Empty';
        rubricsEl.className = 'status-pill status-empty';
        appState.rubricLoaded = false;
    }
}

// ─── File Handling ───
function handlePromptFile(input) {
    if (input.files.length > 0) {
        const nameEl = document.getElementById('prompt-file-name');
        nameEl.textContent = input.files[0].name;
        nameEl.classList.remove('hidden');
    }
}

function handleContextFiles(input) {
    const list = document.getElementById('context-file-list');
    list.innerHTML = '';
    for (const f of input.files) {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-2';
        li.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-brand-500"></span> ${f.name}`;
        list.appendChild(li);
    }
}

function handleRubricFile(input) {
    if (input.files.length > 0) {
        const nameEl = document.getElementById('rubric-file-name');
        nameEl.textContent = input.files[0].name;
        nameEl.classList.remove('hidden');
    }
}

// ─── Drag & Drop ───
document.addEventListener('DOMContentLoaded', () => {
    ['prompt-dropzone', 'context-dropzone', 'rubric-dropzone'].forEach(id => {
        const zone = document.getElementById(id);
        if (!zone) return;

        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('dragover');
            const input = zone.querySelector('input[type="file"]');
            if (input && e.dataTransfer.files.length > 0) {
                input.files = e.dataTransfer.files;
                input.dispatchEvent(new Event('change'));
            }
        });
    });

    fetchStatus();
});

// ─── Upload ───
async function uploadAll() {
    const formData = new FormData();

    const promptText = document.getElementById('prompt-text').value.trim();
    const rubricText = document.getElementById('rubric-text').value.trim();
    const promptFile = document.getElementById('prompt-file').files[0];
    const rubricFile = document.getElementById('rubric-file').files[0];
    const contextFiles = document.getElementById('context-files').files;

    if (promptText) formData.append('prompt_text', promptText);
    if (rubricText) formData.append('rubric_text', rubricText);
    if (promptFile) formData.append('prompt_file', promptFile);
    if (rubricFile) formData.append('rubric_file', rubricFile);
    for (const f of contextFiles) {
        formData.append('context_files', f);
    }

    if (!promptText && !promptFile && contextFiles.length === 0 && !rubricText && !rubricFile) {
        showToast('Please provide at least a prompt, context files, or rubrics.', 'warn');
        return;
    }

    showLoading('Uploading & processing files...', 'Extracting text from documents');

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        updateStatus(data);
        showToast('Materials uploaded successfully!', 'success');
    } catch (e) {
        showToast('Upload failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        updateStatus(data);
        if (data.llm_responses) {
            appState.llmResponses = data.llm_responses;
            updateRheaModelSelect();
        }
    } catch (e) {
        // silent
    }
}

// ─── Clear All ───
async function clearAll() {
    try {
        await fetch('/api/clear', { method: 'POST' });
        document.getElementById('prompt-text').value = '';
        document.getElementById('rubric-text').value = '';
        document.getElementById('prompt-file').value = '';
        document.getElementById('rubric-file').value = '';
        document.getElementById('context-files').value = '';
        document.getElementById('context-file-list').innerHTML = '';
        document.getElementById('prompt-file-name').classList.add('hidden');
        document.getElementById('rubric-file-name').classList.add('hidden');
        document.getElementById('prompt-analysis-results').innerHTML = '<div class="empty-state"><p>Upload a prompt and click "Analyze Prompt" to evaluate its quality.</p></div>';
        document.getElementById('rubric-analysis-results').innerHTML = '<div class="empty-state"><p>Upload a prompt and rubrics, then click "Analyze Rubrics" to evaluate quality and coverage.</p></div>';
        document.getElementById('llm-results').innerHTML = '<div class="empty-state"><p>Select models and click "Run Selected Models" to generate responses.</p></div>';
        document.getElementById('rhea-results').innerHTML = '<div class="empty-state"><p>Run models in the "LLM Testing" tab first, then select a response to evaluate against rubrics.</p></div>';
        appState = { promptLoaded: false, rubricLoaded: false, contextFilesCount: 0, llmResponses: {}, rheaResults: {} };
        const pdfBtn = document.getElementById('btn-rhea-pdf');
        if (pdfBtn) pdfBtn.classList.add('hidden');
        // Reset tab state
        for (const k of Object.keys(llmRawResponses)) delete llmRawResponses[k];
        for (const k of Object.keys(mdToggleState)) delete mdToggleState[k];
        activeModelTab = null;
        updateStatus({ prompt_loaded: false, prompt_length: 0, context_files_count: 0, rubric_loaded: false, rubric_length: 0 });
        updateRheaModelSelect();
        showToast('All data cleared.', 'success');
    } catch (e) {
        showToast('Clear failed: ' + e.message, 'error');
    }
}

// ─── Prompt Analysis ───
async function analyzePrompt() {
    const promptText = document.getElementById('prompt-text').value.trim();
    const promptFile = document.getElementById('prompt-file').files[0];

    if (promptText || promptFile) {
        showLoading('Uploading prompt...', 'Preparing for analysis');
        try {
            const formData = new FormData();
            if (promptText) formData.append('prompt_text', promptText);
            if (promptFile) formData.append('prompt_file', promptFile);
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
            const uploadData = await uploadRes.json();
            updateStatus(uploadData);
        } catch (e) {
            showToast('Upload failed: ' + e.message, 'error');
            hideLoading();
            return;
        }
    }

    showLoading('Analyzing prompt quality...', 'Sending to Sonnet 4.6 for evaluation');

    try {
        const res = await fetch('/api/analyze/prompt', { method: 'POST' });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        renderPromptAnalysis(data);
    } catch (e) {
        showToast('Prompt analysis failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderPromptAnalysis(data) {
    const container = document.getElementById('prompt-analysis-results');

    const overallScore = data.overall_score || 0;
    const scoreClass = `score-${Math.round(overallScore)}`;

    let html = `
        <div class="summary-bar">
            <div class="summary-stat">
                <div class="score-badge ${scoreClass}">${overallScore.toFixed(1)}</div>
                <span class="label">Overall</span>
            </div>
            <div class="flex-1 text-sm text-gray-700">${data.overall_feedback || ''}</div>
        </div>
    `;

    if (data.dimensions && data.dimensions.length > 0) {
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">';
        for (const dim of data.dimensions) {
            const sc = `score-${Math.round(dim.score)}`;
            html += `
                <div class="result-card">
                    <div class="result-card-header">
                        <span class="font-medium text-gray-800">${dim.name}</span>
                        <span class="score-badge ${sc}">${dim.score}</span>
                    </div>
                    <p class="text-sm text-gray-600">${dim.feedback}</p>
                </div>
            `;
        }
        html += '</div>';
    }

    if (data.critical_issues && data.critical_issues.length > 0) {
        html += `
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 class="text-sm font-semibold text-red-800 mb-2">Critical Issues</h4>
                <ul class="list-disc list-inside text-sm text-red-700 space-y-1">
                    ${data.critical_issues.map(i => `<li>${i}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    container.innerHTML = html;
}

// ─── Rubric Analysis ───
async function analyzeRubrics() {
    const promptText = document.getElementById('prompt-text').value.trim();
    const promptFile = document.getElementById('prompt-file').files[0];
    const rubricText = document.getElementById('rubric-text').value.trim();
    const rubricFile = document.getElementById('rubric-file').files[0];

    if (promptText || promptFile || rubricText || rubricFile) {
        showLoading('Uploading materials...', 'Preparing for rubric analysis');
        try {
            const formData = new FormData();
            if (promptText) formData.append('prompt_text', promptText);
            if (promptFile) formData.append('prompt_file', promptFile);
            if (rubricText) formData.append('rubric_text', rubricText);
            if (rubricFile) formData.append('rubric_file', rubricFile);
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
            const uploadData = await uploadRes.json();
            updateStatus(uploadData);
        } catch (e) {
            showToast('Upload failed: ' + e.message, 'error');
            hideLoading();
            return;
        }
    }

    showLoading('Analyzing rubric quality...', 'Evaluating against 7 quality dimensions + coverage gaps');

    try {
        const res = await fetch('/api/analyze/rubrics', { method: 'POST' });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        renderRubricAnalysis(data);
    } catch (e) {
        showToast('Rubric analysis failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderRubricAnalysis(data) {
    const container = document.getElementById('rubric-analysis-results');
    const qualityClass = data.overall_quality === 'good' ? 'quality-good' :
                          data.overall_quality === 'acceptable' ? 'quality-acceptable' : 'quality-needs-work';

    let html = `
        <div class="flex justify-end mb-3">
            <button
                onclick="copyRubricMarkdown()"
                class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded-lg shadow transition-colors"
                title="Copy Slack-ready Markdown to clipboard"
            >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
                Copy as Markdown (Slack)
            </button>
        </div>
        <div class="summary-bar">
            <div class="summary-stat">
                <div class="value ${qualityClass}">${(data.overall_quality || 'N/A').replace('_', ' ').toUpperCase()}</div>
                <span class="label">Overall Quality</span>
            </div>
            ${data.stats ? `
            <div class="summary-stat">
                <div class="value text-green-600">${data.stats.pass}</div>
                <span class="label">Pass</span>
            </div>
            <div class="summary-stat">
                <div class="value text-yellow-600">${data.stats.warn}</div>
                <span class="label">Warnings</span>
            </div>
            <div class="summary-stat">
                <div class="value text-red-600">${data.stats.fail}</div>
                <span class="label">Fail</span>
            </div>
            ` : ''}
            <div class="flex-1 text-sm text-gray-700">${data.overall_feedback || ''}</div>
        </div>
    `;

    if (data.rubric_evaluations && data.rubric_evaluations.length > 0) {
        html += `
            <div class="mb-6">
                <h3 class="text-sm font-semibold text-gray-700 mb-3">Per-Rubric Evaluation</h3>
                <table class="eval-table">
                    <thead>
                        <tr>
                            <th class="w-12">#</th>
                            <th>Criterion</th>
                            <th class="w-24">Quality</th>
                            <th>Issues</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        data.rubric_evaluations.forEach((rubric, idx) => {
            const badge = rubric.quality === 'pass' ? 'badge-pass' :
                          rubric.quality === 'warn' ? 'badge-warn' : 'badge-fail';
            const issues = (rubric.issues || []).map(i =>
                `<span class="text-xs"><strong>${i.dimension}</strong>: ${i.detail}</span>`
            ).join('<br>');

            html += `
                <tr>
                    <td class="text-gray-400">${idx + 1}</td>
                    <td class="text-gray-800">${rubric.criterion}</td>
                    <td><span class="${badge}">${rubric.quality.toUpperCase()}</span></td>
                    <td class="text-gray-600">${issues || '—'}</td>
                </tr>
            `;
        });
        html += '</tbody></table></div>';
    }

    if (data.coverage_gaps && data.coverage_gaps.length > 0) {
        html += `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 class="text-sm font-semibold text-yellow-800 mb-2">Coverage Gaps</h4>
                <p class="text-xs text-yellow-600 mb-3">Topics found in the prompt but NOT covered by any rubric:</p>
                <ul class="space-y-2">
                    ${data.coverage_gaps.map(g => `
                        <li class="text-sm">
                            <strong class="text-yellow-800">${g.prompt_topic}</strong>
                            <span class="text-yellow-700"> — ${g.detail}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    container.innerHTML = html;
    container._rubricData = data;
}

function buildRubricMarkdown(data) {
    const q = (data.overall_quality || 'N/A').replace('_', ' ').toUpperCase();
    const icon = data.overall_quality === 'good' ? ':white_check_mark:' :
                 data.overall_quality === 'acceptable' ? ':warning:' : ':x:';
    const s = data.stats || { pass: 0, warn: 0, fail: 0, total_rubrics: 0 };

    let md = `*${icon} Rubric Analysis — Overall: ${q}*\n`;
    md += `✅ Pass: ${s.pass}  |  ⚠️ Warn: ${s.warn}  |  ❌ Fail: ${s.fail}  |  Total: ${s.total_rubrics}\n`;

    if (data.overall_feedback) {
        md += `\n_${data.overall_feedback}_\n`;
    }

    if (data.rubric_evaluations && data.rubric_evaluations.length > 0) {
        md += `\n*Per-Rubric Evaluation*\n`;
        data.rubric_evaluations.forEach((rubric, idx) => {
            const statusIcon = rubric.quality === 'pass' ? '✅' :
                               rubric.quality === 'warn' ? '⚠️' : '❌';
            md += `\n${idx + 1}. ${statusIcon} *[${rubric.quality.toUpperCase()}]* ${rubric.criterion}`;
            if (rubric.issues && rubric.issues.length > 0) {
                rubric.issues.forEach(i => {
                    md += `\n   • *${i.dimension}*: ${i.detail}`;
                });
            }
            md += '\n';
        });
    }

    if (data.coverage_gaps && data.coverage_gaps.length > 0) {
        md += `\n*⚠️ Coverage Gaps* — Topics in prompt with no rubric coverage:\n`;
        data.coverage_gaps.forEach(g => {
            md += `• *${g.prompt_topic}* — ${g.detail}\n`;
        });
    }

    return md.trim();
}

function copyRubricMarkdown() {
    const container = document.getElementById('rubric-analysis-results');
    const data = container._rubricData;
    if (!data) {
        showToast('No rubric analysis to copy.', 'warn');
        return;
    }
    const md = buildRubricMarkdown(data);
    navigator.clipboard.writeText(md).then(() => {
        showToast('Markdown copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Could not copy — try HTTPS or allow clipboard access.', 'error');
    });
}

// ─── LLM Testing ───
async function runLLMs() {
    const models = [];
    if (document.getElementById('model-gpt').checked) models.push('gpt');
    if (document.getElementById('model-gemini').checked) models.push('gemini');
    if (document.getElementById('model-opus').checked) models.push('opus');

    if (models.length === 0) {
        showToast('Please select at least one model.', 'warn');
        return;
    }

    const modelNames = models.map(m => m === 'gpt' ? 'GPT 5.4' : m === 'gemini' ? 'Gemini 3.1 Pro' : 'Opus 4.6').join(', ');
    showLoading(`Running ${models.length} model(s)...`, `Sending prompt to: ${modelNames}`);

    try {
        const res = await fetch('/api/llm/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ models })
        });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        // Merge new results into accumulated state (don't reset existing tabs)
        let firstNewKey = null;
        for (const r of data.results) {
            const key = r.model.toLowerCase().replace(/ /g, '_').replace(/\./g, '');
            appState.llmResponses[key] = r;
            if (r.status === 'success') {
                llmRawResponses[key] = r.response || '';
                if (!(key in mdToggleState)) mdToggleState[key] = true;
            }
            if (!firstNewKey) firstNewKey = key;
        }

        // Switch to the first newly-run model tab
        if (firstNewKey) activeModelTab = firstNewKey;

        renderAllLLMTabs();
        updateRheaModelSelect();
    } catch (e) {
        showToast('LLM run failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// Preferred display order for model tabs
const MODEL_ORDER = ['gpt_54', 'gemini_31_pro', 'opus_46'];

function renderAllLLMTabs() {
    const container = document.getElementById('llm-results');
    const keys = MODEL_ORDER.filter(k => k in appState.llmResponses);

    if (keys.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Select models and click "Run Selected Models" to generate responses.</p></div>';
        return;
    }

    if (!activeModelTab || !keys.includes(activeModelTab)) {
        activeModelTab = keys[0];
    }

    // ── Tab bar ──────────────────────────────────────────────────────────
    let tabBarHtml = '<div class="llm-tab-bar">';
    for (const key of keys) {
        const r = appState.llmResponses[key];
        const isActive = key === activeModelTab;
        const dot = r.status === 'success'
            ? '<span class="tab-dot tab-dot-ok"></span>'
            : '<span class="tab-dot tab-dot-err"></span>';
        tabBarHtml += `
            <button class="llm-tab${isActive ? ' llm-tab-active' : ''}" onclick="switchModelTab('${key}')">
                ${dot}${escapeHtml(r.model)}
            </button>`;
    }
    tabBarHtml += '</div>';

    // ── Active tab content ────────────────────────────────────────────────
    const activeR = appState.llmResponses[activeModelTab];
    const isSuccess = activeR.status === 'success';
    const isRendered = mdToggleState[activeModelTab] !== false;

    const warningBanner = activeR.warning
        ? `<div class="truncation-warning">⚠️ ${escapeHtml(activeR.warning)}</div>`
        : '';

    let bodyContent;
    if (isSuccess) {
        bodyContent = isRendered
            ? marked.parse(activeR.response || '')
            : escapeHtml(activeR.response || '');
    } else {
        bodyContent = `<span style="color:#991b1b">Error: ${escapeHtml(activeR.error || 'Unknown error')}</span>`;
    }

    const toolbar = isSuccess ? `
        <div class="llm-tab-toolbar">
            <label class="md-toggle-label">
                <input type="checkbox" id="md-toggle-active" ${isRendered ? 'checked' : ''}
                    onchange="toggleMarkdown('${activeModelTab}')">
                <span>Render MD</span>
            </label>
            <button class="btn-download-pdf" onclick="downloadResponsePDF('${activeModelTab}')">⬇ PDF</button>
        </div>` : '';

    const bodyClass = isSuccess
        ? (isRendered ? 'response-body markdown-rendered' : 'response-body markdown-raw')
        : 'response-body';

    const contentHtml = `
        <div class="llm-tab-panel">
            ${toolbar}
            ${warningBanner}
            <div class="${bodyClass}" id="llm-body-active">${bodyContent}</div>
        </div>`;

    container.innerHTML = tabBarHtml + contentHtml;
}

function switchModelTab(key) {
    activeModelTab = key;
    renderAllLLMTabs();
}

function toggleMarkdown(modelKey) {
    const checkbox = document.getElementById('md-toggle-active');
    const bodyEl = document.getElementById('llm-body-active');
    const raw = llmRawResponses[modelKey] || '';

    mdToggleState[modelKey] = checkbox.checked;

    if (checkbox.checked) {
        bodyEl.innerHTML = marked.parse(raw);
        bodyEl.className = 'response-body markdown-rendered';
    } else {
        bodyEl.textContent = raw;
        bodyEl.className = 'response-body markdown-raw';
    }
}

async function downloadResponsePDF(modelKey) {
    const checkbox = document.getElementById(`md-toggle-${modelKey}`);
    const isRaw = !(checkbox && checkbox.checked);

    const btn = document.querySelector(`button[onclick="downloadResponsePDF('${modelKey}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res = await fetch('/api/llm/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_key: modelKey, is_raw: isRaw })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${modelKey}_response.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast('PDF download failed: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
    }
}

// ─── Rhea Evaluator ───
function updateRheaModelSelect() {
    const select = document.getElementById('rhea-model-select');
    select.innerHTML = '<option value="">Select a model response...</option>';
    for (const [key, val] of Object.entries(appState.llmResponses)) {
        if (val.status === 'success') {
            select.innerHTML += `<option value="${key}">${val.model}</option>`;
        }
    }
}

async function runRhea() {
    const modelKey = document.getElementById('rhea-model-select').value;
    if (!modelKey) {
        showToast('Please select a model response to evaluate.', 'warn');
        return;
    }

    const modelName = appState.llmResponses[modelKey]?.model || modelKey;
    showLoading('Running Rhea evaluation...', `Evaluating ${modelName} response against rubrics`);

    try {
        const res = await fetch('/api/rhea/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_key: modelKey })
        });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        appState.rheaResults[modelKey] = data;
        renderRheaResults();
    } catch (e) {
        showToast('Rhea evaluation failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

async function runRheaAll() {
    const keys = Object.entries(appState.llmResponses)
        .filter(([_, v]) => v.status === 'success')
        .map(([k, _]) => k);

    if (keys.length === 0) {
        showToast('No model responses available. Run models first.', 'warn');
        return;
    }

    showLoading('Running Rhea on all models...', `Evaluating ${keys.length} responses`);

    try {
        for (const key of keys) {
            document.getElementById('loading-subtext').textContent =
                `Evaluating ${appState.llmResponses[key].model}...`;

            const res = await fetch('/api/rhea/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_key: key })
            });
            const data = await res.json();

            if (!data.error) {
                appState.rheaResults[key] = data;
            }
        }
        renderRheaResults();
    } catch (e) {
        showToast('Rhea evaluation failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderRheaResults() {
    const container = document.getElementById('rhea-results');
    const entries = Object.entries(appState.rheaResults);

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No evaluation results yet.</p></div>';
        return;
    }

    const isSingle = entries.length === 1;

    // ── Summary cards (one per model, always shown horizontally) ──────────
    let html = '<div class="rhea-summary-row">';
    for (const [key, data] of entries) {
        const summary = data.summary || {};
        const total = summary.total || 0;
        const passed = summary.passed || 0;
        const failed = summary.failed || 0;
        const passRate = summary.pass_rate || 0;
        const scored = summary.scored_points || 0;
        const max = summary.max_points || 0;
        const pointsRate = summary.points_rate || 0;
        const passRateColor = passRate >= 80 ? 'text-green-600' : passRate >= 50 ? 'text-yellow-600' : 'text-red-600';

        html += `
            <div class="rhea-summary-card">
                <div class="result-card-header">
                    <h3 class="font-semibold text-gray-800">${escapeHtml(data.model_name || key)}</h3>
                    <span class="${passRateColor} text-sm font-bold">${passRate}% pass rate</span>
                </div>
                <div class="rhea-stats-row">
                    <div class="summary-stat">
                        <div class="value text-gray-800">${total}</div>
                        <span class="label">Total</span>
                    </div>
                    <div class="summary-stat">
                        <div class="value text-green-600">${passed}</div>
                        <span class="label">Passed</span>
                    </div>
                    <div class="summary-stat">
                        <div class="value text-red-600">${failed}</div>
                        <span class="label">Failed</span>
                    </div>
                    <div class="rhea-points-stat">
                        <span class="rhea-points-value">${scored} / ${max} pts</span>
                        <span class="rhea-points-pct">${pointsRate}%</span>
                    </div>
                </div>
            </div>`;
    }
    html += '</div>';

    // ── Evaluation table ───────────────────────────────────────────────────
    if (isSingle) {
        // Single model: Criteria | Pts | Status | Reason
        const [key, data] = entries[0];
        html += `
            <div class="overflow-x-auto mt-4">
                <table class="eval-table">
                    <thead>
                        <tr>
                            <th>Criteria</th>
                            <th class="rhea-th-pts">Pts</th>
                            <th class="rhea-th-status">Status</th>
                            <th>Reason</th>
                        </tr>
                    </thead>
                    <tbody>`;
        for (const ev of (data.evaluations || [])) {
            const badge = ev.status === 'PASS' ? 'badge-pass' : 'badge-fail';
            html += `
                <tr>
                    <td class="text-gray-700">${escapeHtml(ev.criteria)}</td>
                    <td class="text-center text-gray-500 text-xs font-medium">${ev.points ?? ''}</td>
                    <td><span class="${badge}">${ev.status}</span></td>
                    <td class="text-gray-500 text-xs rhea-reason-cell">${escapeHtml(ev.reason || '—')}</td>
                </tr>`;
        }
        html += '</tbody></table></div>';
    } else {
        // Multi-model: unified table aligned by row index
        // Columns: Criteria | Pts | [Model1 Status | Reason] | [Model2 Status | Reason] ...
        const maxRows = Math.max(...entries.map(([, d]) => (d.evaluations || []).length));

        html += '<div class="overflow-x-auto mt-4"><table class="eval-table rhea-multi-table"><thead><tr>';
        html += '<th class="rhea-th-criteria">Criteria</th>';
        html += '<th class="rhea-th-pts">Pts</th>';
        for (const [, data] of entries) {
            const name = escapeHtml(data.model_name || '');
            html += `<th class="rhea-th-status">${name}</th><th class="rhea-th-reason">Reason</th>`;
        }
        html += '</tr></thead><tbody>';

        for (let i = 0; i < maxRows; i++) {
            // Use first model's criteria text as the shared criteria label
            const firstEv = (entries[0][1].evaluations || [])[i];
            const criteriaText = firstEv ? escapeHtml(firstEv.criteria) : '—';
            const pts = firstEv ? (firstEv.points ?? '') : '';

            html += `<tr>
                <td class="text-gray-700 rhea-criteria-cell">${criteriaText}</td>
                <td class="text-center text-gray-500 text-xs font-medium">${pts}</td>`;

            for (const [, data] of entries) {
                const ev = (data.evaluations || [])[i];
                if (ev) {
                    const badge = ev.status === 'PASS' ? 'badge-pass' : 'badge-fail';
                    html += `<td class="text-center"><span class="${badge}">${ev.status}</span></td>
                             <td class="text-gray-500 text-xs rhea-reason-cell">${escapeHtml(ev.reason || '—')}</td>`;
                } else {
                    html += '<td>—</td><td>—</td>';
                }
            }
            html += '</tr>';
        }

        html += '</tbody></table></div>';
    }

    container.innerHTML = html;

    // Show the PDF download button now that there are results
    const pdfBtn = document.getElementById('btn-rhea-pdf');
    if (pdfBtn) pdfBtn.classList.remove('hidden');
}

async function downloadRheaPDF() {
    if (!appState.rheaResults || Object.keys(appState.rheaResults).length === 0) {
        showToast('No Rhea results to export.', 'warn');
        return;
    }

    const btn = document.getElementById('btn-rhea-pdf');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res = await fetch('/api/rhea/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rhea_results: appState.rheaResults })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rhea_evaluation.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('PDF downloaded!', 'success');
    } catch (e) {
        showToast('PDF download failed: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
    }
}

// ─── Utilities ───
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        warn: 'bg-yellow-500',
        info: 'bg-brand-600'
    };
    toast.className = `fixed bottom-6 right-6 ${colors[type] || colors.info} text-white px-6 py-3 rounded-lg shadow-lg z-50 text-sm font-medium transition-all transform translate-y-0 opacity-100`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
