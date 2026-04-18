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
        const count = data.rubric_count ?? 0;
        rubricsEl.textContent = `Rubrics: ${count} item${count !== 1 ? 's' : ''}`;
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
        nameEl.className = 'upload-file-tag';
    }
}

function handleContextFiles(input) {
    const list = document.getElementById('context-file-list');
    list.innerHTML = '';
    for (const f of input.files) {
        const li = document.createElement('li');
        li.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${f.name}`;
        list.appendChild(li);
    }
}

function handleRubricFile(input) {
    if (input.files.length > 0) {
        const nameEl = document.getElementById('rubric-file-name');
        nameEl.textContent = input.files[0].name;
        nameEl.className = 'upload-file-tag';
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
        const pfn = document.getElementById('prompt-file-name');
        pfn.textContent = ''; pfn.className = 'upload-file-tag hidden';
        const rfn = document.getElementById('rubric-file-name');
        rfn.textContent = ''; rfn.className = 'upload-file-tag hidden';
        document.getElementById('prompt-analysis-results').innerHTML = '<div class="empty-state"><p>Upload a prompt and click "Analyze Prompt" to evaluate its quality.</p></div>';
        document.getElementById('rubric-analysis-results').innerHTML = '<div class="empty-state"><p>Upload a prompt and rubrics, then click "Analyze Rubrics" to evaluate quality and coverage.</p></div>';
        document.getElementById('llm-results').innerHTML = '<div class="empty-state"><p>Select models and click "Run Selected Models" to generate responses.</p></div>';
        document.getElementById('rhea-results').innerHTML = '<div class="empty-state"><p>Run models in the "LLM Testing" tab first, then select a response to evaluate against rubrics.</p></div>';
        const adv = document.getElementById('adversarial-results');
        if (adv) {
            adv.innerHTML = '<div class="empty-state"><p>Upload a prompt and rubrics, then run <strong>Analyze &amp; Harden</strong>. Optionally run Rhea first and check <strong>Include Rhea results</strong> to flag criteria all models passed.</p></div>';
        }
        adversarialLastHardened = '';
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
    const scoreColor = overallScore >= 4.5 ? '#16a34a' : overallScore >= 3 ? '#ca8a04' : '#dc2626';
    const dims = data.dimensions || [];

    // ── PDF button + overall score header ──────────────────────────────────
    let html = `
        <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-4">
                <div style="width:52px;height:52px;border-radius:50%;background:${scoreColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <span style="color:#fff;font-size:1.25rem;font-weight:700;">${overallScore.toFixed(1)}</span>
                </div>
                <p class="text-sm text-gray-600 max-w-xl">${data.overall_feedback || ''}</p>
            </div>
            <button onclick="downloadPromptPDF()" id="btn-prompt-pdf" class="btn-download-pdf" style="flex-shrink:0;">⬇ PDF</button>
        </div>`;

    // ── Score summary strip ────────────────────────────────────────────────
    if (dims.length > 0) {
        html += '<div class="prompt-score-strip">';
        for (const dim of dims) {
            const color = dim.score >= 4.5 ? '#16a34a' : dim.score >= 3 ? '#ca8a04' : '#dc2626';
            const shortName = dim.name.replace('Crisis Scenario ', '').replace(' Quality', '').replace('Organizational ', 'Org. ');
            html += `
                <div class="prompt-score-pill">
                    <span class="prompt-score-pill-label">${shortName}</span>
                    <span class="prompt-score-pill-value" style="color:${color};">${dim.score}</span>
                </div>`;
        }
        html += '</div>';
    }

    // ── Critical issues ────────────────────────────────────────────────────
    if (data.critical_issues && data.critical_issues.length > 0) {
        html += `
            <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <h4 class="text-xs font-semibold text-red-800 mb-1.5 uppercase tracking-wide">Must Fix Before Submission</h4>
                <ul class="space-y-1">
                    ${data.critical_issues.map(i => `<li class="flex gap-2 text-sm text-red-700"><span class="mt-0.5 flex-shrink-0">✗</span>${i}</li>`).join('')}
                </ul>
            </div>`;
    }

    // ── Raw response (when system prompt didn't return JSON) ───────────────
    if (data.raw_response) {
        const rawId = 'raw-resp-' + Math.random().toString(36).slice(2);
        html += `
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        <span class="text-xs font-semibold text-amber-800">Raw model response (JSON parse failed — check active System Prompt)</span>
                    </div>
                    <button onclick="document.getElementById('${rawId}').classList.toggle('hidden')" class="text-xs text-amber-700 underline hover:text-amber-900">Show/Hide</button>
                </div>
                <pre id="${rawId}" class="hidden mt-2 text-xs text-amber-900 bg-amber-100 rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">${escapeHtml(data.raw_response)}</pre>
            </div>`;
    }

    // ── Per-dimension cards ────────────────────────────────────────────────
    if (dims.length > 0) {
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
        for (const dim of dims) {
            const color = dim.score >= 4.5 ? '#16a34a' : dim.score >= 3 ? '#ca8a04' : '#dc2626';
            const fixes = dim.fixes || [];
            html += `
                <div class="result-card">
                    <div class="result-card-header">
                        <span class="font-medium text-gray-800 text-sm">${dim.name}</span>
                        <span style="background:${color};color:#fff;font-weight:700;font-size:0.8rem;padding:2px 8px;border-radius:999px;">${dim.score}/5</span>
                    </div>
                    ${dim.feedback ? `<p class="text-xs text-gray-500 mb-2 leading-relaxed">${dim.feedback}</p>` : ''}
                    ${fixes.length > 0 ? `
                    <ul class="space-y-1">
                        ${fixes.map(f => `
                            <li class="flex gap-2 text-xs text-gray-700 leading-snug">
                                <span class="flex-shrink-0 font-bold text-brand-600 mt-px">→</span>
                                <span>${f}</span>
                            </li>`).join('')}
                    </ul>` : ''}
                </div>`;
        }
        html += '</div>';
    }

    container.innerHTML = html;
    container._promptData = data;
}

async function downloadPromptPDF() {
    const container = document.getElementById('prompt-analysis-results');
    const data = container._promptData;
    if (!data) {
        showToast('No prompt analysis to export.', 'warn');
        return;
    }

    const btn = document.getElementById('btn-prompt-pdf');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res = await fetch('/api/prompt/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysis: data })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'prompt_analysis.pdf';
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
            <button onclick="downloadRubricPDF()" id="btn-rubric-pdf" class="btn-download-pdf">⬇ PDF</button>
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

async function downloadRubricPDF() {
    const container = document.getElementById('rubric-analysis-results');
    const data = container._rubricData;
    if (!data) {
        showToast('No rubric analysis to export.', 'warn');
        return;
    }

    const btn = document.getElementById('btn-rubric-pdf');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res = await fetch('/api/rubric/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysis: data })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rubric_analysis.pdf';
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
    const isRaw = mdToggleState[modelKey] === false;

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

// ─── Adversarial Lab ───
let adversarialLastHardened = '';

async function analyzeAdversarial() {
    if (!appState.promptLoaded || !appState.rubricLoaded) {
        showToast('Upload a prompt and rubrics first.', 'warn');
        return;
    }

    const includeRhea = document.getElementById('adversarial-include-rhea')?.checked;
    const body = {};
    if (includeRhea && appState.rheaResults && Object.keys(appState.rheaResults).length > 0) {
        body.rhea_results = appState.rheaResults;
    } else if (includeRhea) {
        showToast('No Rhea results in this session; analysis runs without them.', 'warn');
    }

    showLoading('Running Adversarial Lab...', 'Analyzing rubrics and prompt with Claude');

    try {
        const res = await fetch('/api/adversarial/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            renderAdversarialError(data);
            return;
        }

        adversarialLastHardened = data.hardened_rubrics || '';
        renderAdversarialResults(data);
        showToast('Adversarial analysis complete.', 'success');
    } catch (e) {
        showToast('Adversarial analysis failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderAdversarialError(data) {
    const container = document.getElementById('adversarial-results');
    if (!container) return;
    let html = `<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">${escapeHtml(data.error || 'Unknown error')}</div>`;
    if (data.raw_response) {
        html += `<pre class="mt-2 text-xs overflow-x-auto p-2 bg-gray-100 rounded max-h-96">${escapeHtml(String(data.raw_response).slice(0, 8000))}</pre>`;
    }
    container.innerHTML = html;
}

function renderAdversarialResults(data) {
    const container = document.getElementById('adversarial-results');
    if (!container) return;

    const est = escapeHtml(data.estimated_fail_rate || '—');
    const strategies = Array.isArray(data.strategies_used)
        ? data.strategies_used.map(x =>
            `<span class="inline-block mr-2 mb-1 px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-700">${escapeHtml(String(x))}</span>`
        ).join('')
        : '';

    let tooEasy = '';
    if (Array.isArray(data.too_easy_criteria) && data.too_easy_criteria.length) {
        tooEasy = '<table class="eval-table w-full mt-2"><thead><tr><th>Too easy</th><th>Reason</th></tr></thead><tbody>';
        for (const row of data.too_easy_criteria) {
            tooEasy += `<tr><td>${escapeHtml(row.criterion || '')}</td><td>${escapeHtml(row.reason || '')}</td></tr>`;
        }
        tooEasy += '</tbody></table>';
    }

    const mods = (data.prompt_modifications || []).map(m => `<li class="text-gray-700">${escapeHtml(m)}</li>`).join('');
    const traps = (data.context_trap_ideas || []).map(m => `<li class="text-gray-700">${escapeHtml(m)}</li>`).join('');

    const hardened = data.hardened_rubrics || '';

    container.innerHTML = `
<div class="space-y-6">
  <div class="flex flex-wrap items-center gap-3">
    <span class="text-sm font-semibold text-gray-600">Estimated fail rate (model guess):</span>
    <span class="text-lg font-bold text-brand-700">${est}</span>
  </div>
  ${strategies ? `<div><span class="text-sm font-semibold text-gray-600">Strategies:</span><div class="mt-1">${strategies}</div></div>` : ''}
  <div>
    <h3 class="text-sm font-semibold text-gray-800 mb-2">Weakness analysis</h3>
    <div class="text-sm text-gray-700 whitespace-pre-wrap border border-gray-100 rounded-lg p-3 bg-gray-50">${escapeHtml(data.weakness_analysis || '')}</div>
  </div>
  ${tooEasy ? `<div><h3 class="text-sm font-semibold text-gray-800 mb-1">Criteria that were too easy (with Rhea data)</h3>${tooEasy}</div>` : ''}
  <div>
    <h3 class="text-sm font-semibold text-gray-800 mb-2">Prompt modifications</h3>
    <ul class="list-disc pl-5 space-y-1">${mods || '<li class="text-gray-400">—</li>'}</ul>
  </div>
  <div>
    <h3 class="text-sm font-semibold text-gray-800 mb-2">Context trap ideas</h3>
    <ul class="list-disc pl-5 space-y-1">${traps || '<li class="text-gray-400">—</li>'}</ul>
  </div>
  <div>
    <h3 class="text-sm font-semibold text-gray-800 mb-2">Hardened rubrics</h3>
    <p class="text-xs text-gray-500 mb-2">Edit below, then click &quot;Apply Hardened Rubrics&quot; to replace server rubrics.</p>
    <textarea id="adversarial-hardened-textarea" rows="14"
        class="w-full font-mono text-sm rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-brand-500"></textarea>
  </div>
</div>`;

    const ta = document.getElementById('adversarial-hardened-textarea');
    if (ta) ta.value = hardened;
}

async function applyHardenedRubrics() {
    const ta = document.getElementById('adversarial-hardened-textarea');
    const text = ta ? ta.value.trim() : (adversarialLastHardened || '').trim();
    if (!text) {
        showToast('No hardened rubric text to apply. Run Analyze first.', 'warn');
        return;
    }

    try {
        const res = await fetch('/api/adversarial/apply-rubrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rubric_text: text })
        });
        const data = await res.json();
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        await fetchStatus();
        showToast(`Rubrics updated (${data.rubric_count} items).`, 'success');
    } catch (e) {
        showToast('Apply failed: ' + e.message, 'error');
    }
}

// ─── System Prompts Manager ───────────────────────────────────────────────────

let spData = {};   // { service_key: { label, active_id, prompts[] } }
let spExpandedService = null;

async function loadSystemPrompts() {
    try {
        const res = await fetch('/api/system-prompts');
        spData = await res.json();
        renderSpServices();
    } catch (e) {
        document.getElementById('sp-services-list').innerHTML =
            `<div class="empty-state"><p>Failed to load system prompts: ${e.message}</p></div>`;
    }
}

function renderSpServices() {
    const container = document.getElementById('sp-services-list');
    if (!container) return;

    const serviceOrder = ['prompt_analyzer', 'rubric_analyzer', 'rhea_evaluator', 'adversarial_engine', 'llm_runner'];
    const keys = serviceOrder.filter(k => spData[k]);

    container.innerHTML = keys.map(key => renderSpServiceBlock(key)).join('');
}

function renderSpServiceBlock(serviceKey) {
    const svc = spData[serviceKey];
    const isExpanded = spExpandedService === serviceKey;
    const activePrompt = svc.prompts.find(p => p.id === svc.active_id) || svc.prompts[0];

    const promptCards = svc.prompts.map(p => renderSpPromptCard(serviceKey, p, svc.active_id)).join('');

    return `
    <div class="sp-service-block" id="sp-block-${serviceKey}">
        <div class="sp-service-header">
            <div class="sp-service-title-group" onclick="spToggleService('${serviceKey}')" style="cursor:pointer;flex:1;min-width:0;">
                <svg class="sp-chevron ${isExpanded ? 'sp-chevron-open' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <span class="sp-service-label">${escapeHtml(svc.label)}</span>
                <span class="sp-active-badge">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="12"/></svg>
                    ${escapeHtml(activePrompt ? activePrompt.name : '—')}
                </span>
            </div>
            <div class="sp-service-actions">
                <button class="sp-btn sp-btn-reset" onclick="spResetDefault('${serviceKey}')" title="Reset default to original">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.02"/></svg>
                    Reset Default
                </button>
                <button class="sp-btn sp-btn-new" onclick="spOpenCreate('${serviceKey}')" title="Create new prompt">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New Prompt
                </button>
            </div>
        </div>
        <div class="sp-service-body ${isExpanded ? 'sp-service-body-open' : ''}">
            <div class="sp-prompt-list">${promptCards}</div>
        </div>
    </div>`;
}

function renderSpPromptCard(serviceKey, prompt, activeId) {
    const isActive = prompt.id === activeId;
    const isDefault = prompt.is_default;

    return `
    <div class="sp-prompt-card ${isActive ? 'sp-prompt-card-active' : ''}" id="sp-card-${serviceKey}-${prompt.id}">
        <div class="sp-prompt-card-top">
            <div class="sp-prompt-card-meta">
                <span class="sp-prompt-name">${escapeHtml(prompt.name)}</span>
                ${isDefault ? '<span class="sp-tag-default">Default</span>' : ''}
                ${isActive ? '<span class="sp-tag-active">Active</span>' : ''}
            </div>
            <div class="sp-prompt-card-actions">
                ${!isActive ? `<button class="sp-btn sp-btn-activate" onclick="spActivate('${serviceKey}', '${prompt.id}')">Set Active</button>` : ''}
                <button class="sp-btn sp-btn-edit" onclick="spOpenEdit('${serviceKey}', '${prompt.id}')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                </button>
                ${!isDefault ? `<button class="sp-btn sp-btn-delete" onclick="spDelete('${serviceKey}', '${prompt.id}')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    Delete
                </button>` : ''}
            </div>
        </div>
        <pre class="sp-prompt-preview">${escapeHtml(prompt.content.slice(0, 220))}${prompt.content.length > 220 ? '…' : ''}</pre>
    </div>`;
}

function spToggleService(serviceKey) {
    spExpandedService = spExpandedService === serviceKey ? null : serviceKey;
    renderSpServices();
}

// ── Activate ──
async function spActivate(serviceKey, promptId) {
    try {
        const res = await fetch(`/api/system-prompts/${serviceKey}/${promptId}/activate`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        spData[serviceKey].active_id = promptId;
        renderSpServices();
        showToast('Prompt set as active.', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ── Reset default ──
async function spResetDefault(serviceKey) {
    if (!confirm(`Reset the Default prompt for "${spData[serviceKey]?.label}" to the original built-in version?`)) return;
    try {
        const res = await fetch(`/api/system-prompts/${serviceKey}/reset-default`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        await loadSystemPrompts();
        showToast('Default prompt restored.', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ── Delete ──
async function spDelete(serviceKey, promptId) {
    const svc = spData[serviceKey];
    const prompt = svc.prompts.find(p => p.id === promptId);
    if (!confirm(`Delete "${prompt?.name}"? This cannot be undone.`)) return;
    try {
        const res = await fetch(`/api/system-prompts/${serviceKey}/${promptId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        svc.prompts = svc.prompts.filter(p => p.id !== promptId);
        if (svc.active_id === promptId) svc.active_id = 'default';
        renderSpServices();
        showToast('Prompt deleted.', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ── Modal: open create ──
function spOpenCreate(serviceKey) {
    spExpandedService = serviceKey;
    document.getElementById('sp-modal-title').textContent = `New Prompt — ${spData[serviceKey]?.label}`;
    document.getElementById('sp-modal-service').value = serviceKey;
    document.getElementById('sp-modal-prompt-id').value = '';
    document.getElementById('sp-modal-name').value = '';
    document.getElementById('sp-modal-content').value = '';
    document.getElementById('sp-modal-name-row').style.display = '';
    document.getElementById('sp-modal-save-btn').textContent = 'Create';
    document.getElementById('sp-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('sp-modal-name').focus(), 50);
}

// ── Modal: open edit ──
function spOpenEdit(serviceKey, promptId) {
    spExpandedService = serviceKey;
    const svc = spData[serviceKey];
    const prompt = svc.prompts.find(p => p.id === promptId);
    if (!prompt) return;

    document.getElementById('sp-modal-title').textContent = `Edit — ${prompt.name}`;
    document.getElementById('sp-modal-service').value = serviceKey;
    document.getElementById('sp-modal-prompt-id').value = promptId;
    document.getElementById('sp-modal-content').value = prompt.content;
    document.getElementById('sp-modal-save-btn').textContent = 'Save';

    // Hide name field for default prompt (can't rename)
    if (prompt.is_default) {
        document.getElementById('sp-modal-name-row').style.display = 'none';
        document.getElementById('sp-modal-name').value = '';
    } else {
        document.getElementById('sp-modal-name-row').style.display = '';
        document.getElementById('sp-modal-name').value = prompt.name;
    }

    document.getElementById('sp-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('sp-modal-content').focus(), 50);
}

function spCloseModal() {
    document.getElementById('sp-modal').style.display = 'none';
}

function spModalBackdropClick(e) {
    if (e.target === document.getElementById('sp-modal')) spCloseModal();
}

// ── Modal: save ──
async function spSaveModal() {
    const serviceKey = document.getElementById('sp-modal-service').value;
    const promptId = document.getElementById('sp-modal-prompt-id').value;
    const name = document.getElementById('sp-modal-name').value.trim();
    const content = document.getElementById('sp-modal-content').value;
    const isCreate = !promptId;

    if (isCreate && !name) {
        showToast('Please enter a name for the new prompt.', 'warn');
        return;
    }

    const btn = document.getElementById('sp-modal-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        let res, data;
        if (isCreate) {
            res = await fetch(`/api/system-prompts/${serviceKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, content })
            });
            data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create');
            spData[serviceKey].prompts.push(data);
        } else {
            const svc = spData[serviceKey];
            const isDefault = svc.prompts.find(p => p.id === promptId)?.is_default;
            const body = { content };
            if (!isDefault && name) body.name = name;

            res = await fetch(`/api/system-prompts/${serviceKey}/${promptId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update');
            const idx = svc.prompts.findIndex(p => p.id === promptId);
            if (idx >= 0) svc.prompts[idx] = { ...svc.prompts[idx], ...data };
        }

        spCloseModal();
        renderSpServices();
        showToast(isCreate ? 'Prompt created!' : 'Prompt saved!', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = isCreate ? 'Create' : 'Save';
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
