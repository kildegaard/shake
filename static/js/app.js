// ─── State ───
let appState = {
    promptLoaded: false,
    rubricLoaded: false,
    contextFilesCount: 0,
    // Run history (persisted on server, restored on page load)
    llmRuns: {},       // modelKey → [{run_id, ts, model, status, response, error, warning}]
    promptRuns: [],    // [{run_id, ts, result}]
    rubricRuns: [],    // [{run_id, ts, result}]
    rheaRuns: [],      // [{run_id, ts, model_name, model_key, llm_run_id, result}]
    // Active selections
    activeLLMModel: null,   // active model key for the main model tabs
    activeLLMRun: {},       // modelKey → run_id (active sub-tab per model)
    activePromptRun: null,
    activeRubricRun: null,
    activeRheaRun: null,
};

// Markdown toggle state per model+run (key: modelKey+':'+runId → boolean)
const mdToggleState = {};

// ─── Materials Preview ───
function toggleMaterialsPreview() {
    const content = document.getElementById('materials-preview-content');
    const chevron = document.getElementById('preview-chevron');
    const isHidden = content.classList.contains('hidden');
    content.classList.toggle('hidden', !isHidden);
    chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
}

function switchPreviewTab(tabId) {
    document.querySelectorAll('.preview-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.preview-tab-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById('preview-tab-' + tabId);
    if (target) target.classList.remove('hidden');
    const btn = document.querySelector(`[data-preview-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
}

function renderPromptPreview(promptText) {
    const container = document.getElementById('preview-tab-prompt');
    if (!container) return;
    if (!promptText || !promptText.trim()) {
        container.innerHTML = `<div class="empty-state"><p>Upload a prompt to preview it here.</p></div>`;
        return;
    }
    const rendered = (typeof marked !== 'undefined')
        ? marked.parse(promptText)
        : `<pre class="whitespace-pre-wrap text-sm text-gray-800">${escapeHtml(promptText)}</pre>`;
    container.innerHTML = `
        <div class="flex justify-end mb-3">
            <button onclick="deletePrompt()" class="delete-btn">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                Remove Prompt
            </button>
        </div>
        <div class="prose prose-sm max-w-none text-gray-800 leading-relaxed">${rendered}</div>`;
}

function renderContextFilesPreview(fileNames) {
    const container = document.getElementById('preview-context-container');
    const badge = document.getElementById('preview-context-badge');
    if (!container) return;
    if (!fileNames || fileNames.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>Upload context files to see them listed here.</p></div>`;
        if (badge) badge.classList.add('hidden');
        return;
    }
    if (badge) {
        badge.textContent = fileNames.length;
        badge.classList.remove('hidden');
    }
    const items = fileNames.map(name => `
        <li class="flex items-center gap-2 py-2.5 border-b border-gray-100 last:border-0 group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-brand-400 flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span class="text-sm text-gray-700 flex-1">${escapeHtml(name)}</span>
            <button onclick="deleteContextFile('${escapeHtml(name).replace(/'/g, "\\'")}')" title="Remove file"
                class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </li>
    `).join('');
    container.innerHTML = `
        <div class="flex justify-end mb-3">
            <button onclick="deleteAllContext()" class="delete-btn">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                Remove All Files
            </button>
        </div>
        <ul>${items}</ul>
        <p class="text-xs text-gray-400 mt-3 text-right">${fileNames.length} file${fileNames.length !== 1 ? 's' : ''} loaded</p>`;
}

// ─── Rubrics Table ───
function parseRubrics(text) {
    if (!text || !text.trim()) return [];

    const lines = text.split('\n');
    const rubrics = [];
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const match = line.match(/^\[(-?\d+)\]\s*(.*)/);
        if (match) {
            if (current) rubrics.push(current);
            current = { id: match[1], criterion: match[2].trim(), source: '' };
        } else if (current && /^source\s*:/i.test(line)) {
            current.source = line.replace(/^source\s*:\s*/i, '').trim();
        } else if (current && !current.source) {
            current.criterion += ' ' + line;
        }
    }
    if (current) rubrics.push(current);
    return rubrics;
}

function renderRubricsTable(rubricText) {
    const container = document.getElementById('preview-rubrics-container');
    const badge = document.getElementById('preview-rubrics-badge');
    if (!container) return;

    const rubrics = parseRubrics(rubricText);

    if (rubrics.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>Upload rubrics to verify the registered criteria here.</p></div>`;
        if (badge) badge.classList.add('hidden');
        return;
    }

    if (badge) {
        badge.textContent = rubrics.length;
        badge.classList.remove('hidden');
    }

    const rows = rubrics.map((r, idx) => {
        const isNegative = parseInt(r.id, 10) < 0;
        const idBadge = isNegative
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono bg-red-50 text-red-600 border border-red-200">[${r.id}]</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">[${r.id}]</span>`;
        return `
        <tr class="${idx % 2 === 0 ? '' : 'bg-gray-50'}">
            <td class="px-4 py-3 text-center text-sm text-gray-400 font-mono">${idx + 1}</td>
            <td class="px-4 py-3 text-center">${idBadge}</td>
            <td class="px-4 py-3 text-sm text-gray-800 leading-relaxed">${escapeHtml(r.criterion)}</td>
            <td class="px-4 py-3 text-sm text-gray-400 italic">${r.source ? escapeHtml(r.source) : '<span class="text-gray-300">—</span>'}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="flex justify-end mb-3">
            <button onclick="deleteRubrics()" class="delete-btn">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                Remove Rubrics
            </button>
        </div>
        <div class="overflow-x-auto rounded-lg border border-gray-200">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="bg-gray-50 border-b border-gray-200">
                        <th class="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-12 text-center">No.</th>
                        <th class="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16 text-center">ID</th>
                        <th class="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Criterion</th>
                        <th class="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-44">Source</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p class="text-xs text-gray-400 mt-3 text-right">Showing ${rubrics.length} rubric${rubrics.length !== 1 ? 's' : ''}</p>
    `;
}

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

    renderPromptPreview(data.prompt_text || '');
    renderRubricsTable(data.rubric_text || '');
    renderContextFilesPreview(data.context_file_names || []);

    // Update header badges in the collapsible toggle button
    const headerBadges = document.getElementById('preview-header-badges');
    if (headerBadges) {
        const parts = [];
        if (data.prompt_loaded) parts.push(`<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700">Prompt</span>`);
        if (data.context_files_count > 0) parts.push(`<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700">${data.context_files_count} file${data.context_files_count !== 1 ? 's' : ''}</span>`);
        if (data.rubric_loaded) parts.push(`<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">${data.rubric_count} rubric${data.rubric_count !== 1 ? 's' : ''}</span>`);
        headerBadges.innerHTML = parts.join('');
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
    loadSettings();
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
        clearUploadInputs();
        showToast('Materials uploaded successfully!', 'success');
    } catch (e) {
        showToast('Upload failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function clearUploadInputs() {
    document.getElementById('prompt-text').value = '';
    document.getElementById('rubric-text').value = '';
    ['prompt-file', 'rubric-file', 'context-files'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const promptTag = document.getElementById('prompt-file-name');
    if (promptTag) { promptTag.textContent = ''; promptTag.className = 'upload-file-tag hidden'; }
    const rubricTag = document.getElementById('rubric-file-name');
    if (rubricTag) { rubricTag.textContent = ''; rubricTag.className = 'upload-file-tag hidden'; }
    const contextList = document.getElementById('context-file-list');
    if (contextList) contextList.innerHTML = '';
}

// ─── Selective Delete ───
async function deletePrompt() {
    try {
        const res = await fetch('/api/clear/prompt', { method: 'DELETE' });
        const data = await res.json();
        updateStatus(data);
        showToast('Prompt removed.', 'success');
    } catch (e) {
        showToast('Failed to remove prompt: ' + e.message, 'error');
    }
}

async function deleteRubrics() {
    try {
        const res = await fetch('/api/clear/rubrics', { method: 'DELETE' });
        const data = await res.json();
        updateStatus(data);
        showToast('Rubrics removed.', 'success');
    } catch (e) {
        showToast('Failed to remove rubrics: ' + e.message, 'error');
    }
}

async function deleteAllContext() {
    try {
        const res = await fetch('/api/clear/context', { method: 'DELETE' });
        const data = await res.json();
        updateStatus(data);
        showToast('All context files removed.', 'success');
    } catch (e) {
        showToast('Failed to remove context files: ' + e.message, 'error');
    }
}

async function deleteContextFile(filename) {
    try {
        const res = await fetch(`/api/clear/context/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        const data = await res.json();
        updateStatus(data);
        showToast(`"${filename}" removed.`, 'success');
    } catch (e) {
        showToast('Failed to remove file: ' + e.message, 'error');
    }
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        updateStatus(data);
        // Render expert bar
        renderExpertBar(data.experts || [], data.active_expert_id || null);
        // Restore persisted runs
        if (data.llm_runs) {
            appState.llmRuns = data.llm_runs;
            // Set active model to the first model with runs (if none already set)
            if (!appState.activeLLMModel) {
                const firstKey = MODEL_ORDER.find(k => (appState.llmRuns[k] || []).length > 0);
                if (firstKey) {
                    appState.activeLLMModel = firstKey;
                    const runs = appState.llmRuns[firstKey];
                    appState.activeLLMRun[firstKey] = runs[runs.length - 1].run_id;
                }
            }
            renderAllLLMTabs();
            updateRheaModelSelect();
        }
        if (data.prompt_runs) {
            appState.promptRuns = data.prompt_runs;
            if (!appState.activePromptRun && data.prompt_runs.length > 0) {
                appState.activePromptRun = data.prompt_runs[data.prompt_runs.length - 1].run_id;
            }
            renderPromptRunTabs();
        }
        if (data.rubric_runs) {
            appState.rubricRuns = data.rubric_runs;
            if (!appState.activeRubricRun && data.rubric_runs.length > 0) {
                appState.activeRubricRun = data.rubric_runs[data.rubric_runs.length - 1].run_id;
            }
            renderRubricRunTabs();
        }
        if (data.rhea_runs) {
            appState.rheaRuns = data.rhea_runs;
            if (!appState.activeRheaRun && data.rhea_runs.length > 0) {
                appState.activeRheaRun = data.rhea_runs[data.rhea_runs.length - 1].run_id;
            }
            renderRheaRunTabs();
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
        appState = {
            promptLoaded: false, rubricLoaded: false, contextFilesCount: 0,
            llmRuns: {}, promptRuns: [], rubricRuns: [], rheaRuns: [],
            activeLLMModel: null, activeLLMRun: {},
            activePromptRun: null, activeRubricRun: null, activeRheaRun: null,
        };
        const pdfBtn = document.getElementById('btn-rhea-pdf');
        if (pdfBtn) pdfBtn.classList.add('hidden');
        for (const k of Object.keys(mdToggleState)) delete mdToggleState[k];
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

        const runId = data.run_id;
        // Add to local runs
        appState.promptRuns.push({ run_id: runId, ts: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), result: data });
        appState.activePromptRun = runId;
        renderPromptRunTabs();
    } catch (e) {
        showToast('Prompt analysis failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderPromptRunTabs() {
    const container = document.getElementById('prompt-analysis-results');
    if (appState.promptRuns.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Upload a prompt and click "Analyze Prompt" to evaluate its quality.</p></div>';
        return;
    }
    if (!appState.activePromptRun) appState.activePromptRun = appState.promptRuns[appState.promptRuns.length - 1].run_id;
    const activeRun = appState.promptRuns.find(r => r.run_id === appState.activePromptRun);
    if (!activeRun) return;

    let html = _runsBarHtml(appState.promptRuns, appState.activePromptRun, 'switchPromptRun', 'deletePromptRun');
    container.innerHTML = html;
    renderPromptAnalysis(activeRun.result);
}

function switchPromptRun(runId) {
    appState.activePromptRun = runId;
    renderPromptRunTabs();
}

async function deletePromptRun(runId) {
    try {
        await fetch(`/api/runs/prompt/${runId}`, { method: 'DELETE' });
        appState.promptRuns = appState.promptRuns.filter(r => r.run_id !== runId);
        if (appState.activePromptRun === runId) {
            appState.activePromptRun = appState.promptRuns.length ? appState.promptRuns[appState.promptRuns.length - 1].run_id : null;
        }
        renderPromptRunTabs();
        showToast('Run deleted.', 'success');
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
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

    container.innerHTML += html;
    container._promptData = data;
}

async function downloadPromptPDF() {
    const activeRun = appState.promptRuns.find(r => r.run_id === appState.activePromptRun);
    const data = activeRun?.result || document.getElementById('prompt-analysis-results')._promptData;
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
        a.download = `prompt_analysis_${_dlTimestamp()}.pdf`;
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

        const runId = data.run_id;
        appState.rubricRuns.push({ run_id: runId, ts: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), result: data });
        appState.activeRubricRun = runId;
        renderRubricRunTabs();
    } catch (e) {
        showToast('Rubric analysis failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderRubricRunTabs() {
    const container = document.getElementById('rubric-analysis-results');
    if (appState.rubricRuns.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Upload a prompt and rubrics, then click "Analyze Rubrics" to evaluate quality and coverage.</p></div>';
        return;
    }
    if (!appState.activeRubricRun) appState.activeRubricRun = appState.rubricRuns[appState.rubricRuns.length - 1].run_id;
    const activeRun = appState.rubricRuns.find(r => r.run_id === appState.activeRubricRun);
    if (!activeRun) return;

    let html = _runsBarHtml(appState.rubricRuns, appState.activeRubricRun, 'switchRubricRun', 'deleteRubricRun');
    container.innerHTML = html;
    renderRubricAnalysis(activeRun.result);
}

function switchRubricRun(runId) {
    appState.activeRubricRun = runId;
    renderRubricRunTabs();
}

async function deleteRubricRun(runId) {
    try {
        await fetch(`/api/runs/rubric/${runId}`, { method: 'DELETE' });
        appState.rubricRuns = appState.rubricRuns.filter(r => r.run_id !== runId);
        if (appState.activeRubricRun === runId) {
            appState.activeRubricRun = appState.rubricRuns.length ? appState.rubricRuns[appState.rubricRuns.length - 1].run_id : null;
        }
        renderRubricRunTabs();
        showToast('Run deleted.', 'success');
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
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

    container.innerHTML += html;
    container._rubricData = data;
}

async function downloadRubricPDF() {
    const activeRun = appState.rubricRuns.find(r => r.run_id === appState.activeRubricRun);
    const data = activeRun?.result || document.getElementById('rubric-analysis-results')._rubricData;
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
        a.download = `rubric_analysis_${_dlTimestamp()}.pdf`;
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

// ─── Shared run-tab bar helper ───
function _runsBarHtml(runs, activeRunId, switchFn, deleteFn) {
    if (!runs || runs.length === 0) return '';
    return `<div class="runs-bar">
        ${runs.map(r => {
            const label = r.label || `Run ${r.run_id}`;
            return `<button class="run-tab${r.run_id === activeRunId ? ' run-tab-active' : ''}"
                onclick="${switchFn}(${r.run_id})">
                ${label}
                <span class="run-ts">${r.ts}</span>
                <span class="run-delete" onclick="event.stopPropagation();${deleteFn}(${r.run_id})" title="Delete this run">×</span>
            </button>`;
        }).join('')}
    </div>`;
}

// ─── LLM Testing ───

// Preferred display order for model tabs
const MODEL_ORDER = ['gpt_54', 'gemini_31_pro', 'opus_46'];

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

        // Merge new runs into accumulated state
        const runIds = data.run_ids || {};
        let firstNewKey = null;
        for (const r of data.results) {
            const key = r.model.toLowerCase().replace(/ /g, '_').replace(/\./g, '');
            if (!appState.llmRuns[key]) appState.llmRuns[key] = [];
            const runId = runIds[key];
            const existing = appState.llmRuns[key].find(x => x.run_id === runId);
            if (!existing) {
                appState.llmRuns[key].push({
                    run_id: runId,
                    ts: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
                    model: r.model,
                    status: r.status,
                    response: r.response || '',
                    error: r.error || '',
                    warning: r.warning || '',
                });
            }
            // Set active run to the new one
            appState.activeLLMRun[key] = runId;
            if (!firstNewKey) firstNewKey = key;
        }

        if (firstNewKey) appState.activeLLMModel = firstNewKey;
        renderAllLLMTabs();
        updateRheaModelSelect();
    } catch (e) {
        showToast('LLM run failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderAllLLMTabs() {
    const container = document.getElementById('llm-results');
    const keys = MODEL_ORDER.filter(k => (appState.llmRuns[k] || []).length > 0);

    if (keys.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Select models and click "Run Selected Models" to generate responses.</p></div>';
        return;
    }

    if (!appState.activeLLMModel || !keys.includes(appState.activeLLMModel)) {
        appState.activeLLMModel = keys[0];
    }

    // ── Model tab bar ─────────────────────────────────────────────────────
    let html = '<div class="llm-tab-bar">';
    for (const key of keys) {
        const runs = appState.llmRuns[key];
        const latestRun = runs[runs.length - 1];
        const isActive = key === appState.activeLLMModel;
        const dot = latestRun.status === 'success'
            ? '<span class="tab-dot tab-dot-ok"></span>'
            : '<span class="tab-dot tab-dot-err"></span>';
        html += `<button class="llm-tab${isActive ? ' llm-tab-active' : ''}" onclick="switchModelTab('${key}')">
            ${dot}${escapeHtml(latestRun.model)}
            <span class="llm-tab-run-count">${runs.length}</span>
        </button>`;
    }
    html += '</div>';

    // ── Run sub-tabs for active model ─────────────────────────────────────
    const activeKey = appState.activeLLMModel;
    const activeRuns = appState.llmRuns[activeKey] || [];
    let activeRunId = appState.activeLLMRun[activeKey];
    if (!activeRunId || !activeRuns.find(r => r.run_id === activeRunId)) {
        activeRunId = activeRuns[activeRuns.length - 1]?.run_id;
        appState.activeLLMRun[activeKey] = activeRunId;
    }

    html += '<div class="runs-bar">';
    for (const run of activeRuns) {
        const isRunActive = run.run_id === activeRunId;
        const runDot = run.status === 'success' ? '🟢' : '🔴';
        html += `<button class="run-tab${isRunActive ? ' run-tab-active' : ''}"
            onclick="switchLLMRun('${activeKey}', ${run.run_id})">
            ${runDot} Run ${run.run_id}
            <span class="run-ts">${run.ts}</span>
            <span class="run-delete" onclick="event.stopPropagation();deleteLLMRun('${activeKey}', ${run.run_id})" title="Delete">×</span>
        </button>`;
    }
    html += '</div>';

    // ── Active run content ────────────────────────────────────────────────
    const activeRun = activeRuns.find(r => r.run_id === activeRunId);
    if (!activeRun) { container.innerHTML = html; return; }

    const isSuccess = activeRun.status === 'success';
    const mdKey = `${activeKey}:${activeRunId}`;
    const isRendered = mdToggleState[mdKey] !== false;

    const warningBanner = activeRun.warning
        ? `<div class="truncation-warning">⚠️ ${escapeHtml(activeRun.warning)}</div>` : '';

    let bodyContent;
    if (isSuccess) {
        bodyContent = isRendered
            ? marked.parse(activeRun.response || '')
            : escapeHtml(activeRun.response || '');
    } else {
        bodyContent = `<span style="color:#991b1b">Error: ${escapeHtml(activeRun.error || 'Unknown error')}</span>`;
    }

    const toolbar = isSuccess ? `
        <div class="llm-tab-toolbar">
            <label class="md-toggle-label">
                <input type="checkbox" id="md-toggle-active" ${isRendered ? 'checked' : ''}
                    onchange="toggleMarkdown('${activeKey}', ${activeRunId})">
                <span>Render MD</span>
            </label>
            <button class="btn-download-pdf" id="btn-llm-pdf" onclick="downloadResponsePDF('${activeKey}', ${activeRunId})">⬇ PDF</button>
            <button class="btn-download-pdf btn-llm-all-pdf" id="btn-llm-all-pdf" onclick="downloadAllLLMPDF()">⬇ All PDF</button>
        </div>` : '';

    const bodyClass = isSuccess
        ? (isRendered ? 'response-body markdown-rendered' : 'response-body markdown-raw')
        : 'response-body';

    html += `<div class="llm-tab-panel">
        ${toolbar}${warningBanner}
        <div class="${bodyClass}" id="llm-body-active">${bodyContent}</div>
    </div>`;

    container.innerHTML = html;
}

function switchModelTab(key) {
    appState.activeLLMModel = key;
    renderAllLLMTabs();
}

function switchLLMRun(modelKey, runId) {
    appState.activeLLMRun[modelKey] = runId;
    renderAllLLMTabs();
}

async function deleteLLMRun(modelKey, runId) {
    try {
        await fetch(`/api/runs/llm/${modelKey}/${runId}`, { method: 'DELETE' });
        appState.llmRuns[modelKey] = (appState.llmRuns[modelKey] || []).filter(r => r.run_id !== runId);
        if (!appState.llmRuns[modelKey]?.length) delete appState.llmRuns[modelKey];
        if (appState.activeLLMRun[modelKey] === runId) delete appState.activeLLMRun[modelKey];
        renderAllLLMTabs();
        updateRheaModelSelect();
        showToast('Run deleted.', 'success');
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
    }
}

function toggleMarkdown(modelKey, runId) {
    const checkbox = document.getElementById('md-toggle-active');
    const bodyEl = document.getElementById('llm-body-active');
    const mdKey = `${modelKey}:${runId}`;
    const run = (appState.llmRuns[modelKey] || []).find(r => r.run_id === runId);

    mdToggleState[mdKey] = checkbox.checked;

    if (checkbox.checked) {
        bodyEl.innerHTML = marked.parse(run?.response || '');
        bodyEl.className = 'response-body markdown-rendered';
    } else {
        bodyEl.textContent = run?.response || '';
        bodyEl.className = 'response-body markdown-raw';
    }
}

async function downloadResponsePDF(modelKey, runId) {
    const mdKey = `${modelKey}:${runId}`;
    const isRaw = mdToggleState[mdKey] === false;
    const btn = document.getElementById('btn-llm-pdf');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res = await fetch('/api/llm/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_key: modelKey, run_id: runId, is_raw: isRaw })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${modelKey}_run${runId}_response_${_dlTimestamp()}.pdf`;
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

async function downloadAllLLMPDF() {
    const btn = document.getElementById('btn-llm-all-pdf');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
        const res = await fetch('/api/llm/pdf/all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `llm_all_responses_${_dlTimestamp()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('PDF downloaded!', 'success');
    } catch (e) {
        showToast('PDF download failed: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ All PDF'; }
    }
}

// ─── Rhea Evaluator ───
function updateRheaModelSelect() {
    const select = document.getElementById('rhea-model-select');
    select.innerHTML = '<option value="">Select a model response...</option>';
    for (const [key, runs] of Object.entries(appState.llmRuns)) {
        for (const run of runs) {
            if (run.status === 'success') {
                select.innerHTML += `<option value="${key}:${run.run_id}">${run.model} · Run ${run.run_id} (${run.ts})</option>`;
            }
        }
    }
}

async function runRhea() {
    const val = document.getElementById('rhea-model-select').value;
    if (!val) {
        showToast('Please select a model response to evaluate.', 'warn');
        return;
    }
    const [modelKey, runIdStr] = val.split(':');
    const runId = parseInt(runIdStr, 10);
    const run = (appState.llmRuns[modelKey] || []).find(r => r.run_id === runId);

    showLoading('Running Rhea evaluation...', `Evaluating ${run?.model || modelKey} Run ${runId} against rubrics`);

    try {
        const res = await fetch('/api/rhea/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_key: modelKey, run_id: runId })
        });
        const data = await res.json();

        if (data.error) {
            showToast(data.error, 'error');
            return;
        }

        const rheaRunId = data.run_id;
        appState.rheaRuns.push({
            run_id: rheaRunId,
            ts: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
            model_name: data.model_name,
            model_key: modelKey,
            llm_run_id: runId,
            result: data,
        });
        appState.activeRheaRun = rheaRunId;
        activeRheaModelVersions[modelKey] = rheaRunId;
        activeRheaTab = _rheaModelSlug(modelKey);
        renderRheaRunTabs();
    } catch (e) {
        showToast('Rhea evaluation failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

async function runRheaAll() {
    const allRuns = [];
    for (const [key, runs] of Object.entries(appState.llmRuns)) {
        const successRuns = runs.filter(r => r.status === 'success');
        if (successRuns.length > 0) {
            const latestRun = successRuns[successRuns.length - 1];
            allRuns.push({ modelKey: key, runId: latestRun.run_id, model: latestRun.model });
        }
    }

    if (allRuns.length === 0) {
        showToast('No model responses available. Run models first.', 'warn');
        return;
    }

    showLoading('Running Rhea on all models...', `Evaluating ${allRuns.length} responses`);

    try {
        for (const { modelKey, runId, model } of allRuns) {
            document.getElementById('loading-subtext').textContent = `Evaluating ${model}...`;

            const res = await fetch('/api/rhea/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_key: modelKey, run_id: runId })
            });
            const data = await res.json();

            if (!data.error) {
                const rheaRunId = data.run_id;
                appState.rheaRuns.push({
                    run_id: rheaRunId,
                    ts: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
                    model_name: data.model_name,
                    model_key: modelKey,
                    llm_run_id: runId,
                    result: data,
                });
                appState.activeRheaRun = rheaRunId;
                activeRheaModelVersions[modelKey] = rheaRunId;
            }
        }
        activeRheaTab = 'summary';
        renderRheaRunTabs();
    } catch (e) {
        showToast('Rhea evaluation failed: ' + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// ── Active inner tab for Rhea results ──
let activeRheaTab = 'summary';
// Tracks which run_id is selected per model_key when a model has multiple runs
let activeRheaModelVersions = {};

// Returns a safe HTML-id-friendly key from model_key
function _rheaModelSlug(modelKey) {
    return String(modelKey).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Groups appState.rheaRuns by model_key, preserving insertion order
function _groupRheaRunsByModel() {
    const map = {};
    for (const run of appState.rheaRuns) {
        const key = run.model_key;
        if (!map[key]) map[key] = [];
        map[key].push(run);
    }
    return map;
}

function renderRheaRunTabs() {
    const container = document.getElementById('rhea-results');
    if (appState.rheaRuns.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Run models in the "LLM Testing" tab first, then select a response to evaluate against rubrics.</p></div>';
        const pdfBtn = document.getElementById('btn-rhea-pdf');
        if (pdfBtn) pdfBtn.classList.add('hidden');
        activeRheaTab = 'summary';
        return;
    }

    const runsByModel = _groupRheaRunsByModel();

    // Ensure activeRheaModelVersions points to a valid run for each model
    for (const [key, runs] of Object.entries(runsByModel)) {
        const cur = activeRheaModelVersions[key];
        if (!cur || !runs.find(r => r.run_id === cur)) {
            // Default to the latest run
            activeRheaModelVersions[key] = runs[runs.length - 1].run_id;
        }
    }

    // Validate activeRheaTab still refers to an existing model slug
    if (activeRheaTab !== 'summary') {
        const slugExists = Object.keys(runsByModel).some(k => _rheaModelSlug(k) === activeRheaTab || k === activeRheaTab);
        if (!slugExists) activeRheaTab = 'summary';
    }

    // Build inner tab bar: Summary + one tab per unique model
    let tabBar = '<div class="rhea-inner-tabbar" id="rhea-inner-tabbar">';
    tabBar += `<button class="rhea-inner-tab ${activeRheaTab === 'summary' ? 'rhea-inner-tab-active' : ''}" onclick="switchRheaInnerTab('summary')">Summary</button>`;
    for (const [modelKey, runs] of Object.entries(runsByModel)) {
        const latestRun = runs[runs.length - 1];
        const label = escapeHtml(latestRun.result?.model_name || latestRun.model_name || modelKey);
        const slug = _rheaModelSlug(modelKey);
        const isActive = activeRheaTab === slug || activeRheaTab === modelKey;
        tabBar += `<button class="rhea-inner-tab ${isActive ? 'rhea-inner-tab-active' : ''}" onclick="switchRheaInnerTab('${slug}')" data-model-key="${escapeHtml(modelKey)}">${label}</button>`;
    }
    tabBar += '</div>';

    // Build summary panel — uses only the latest run per model
    let summaryPanel = `<div class="rhea-inner-panel ${activeRheaTab === 'summary' ? '' : 'hidden'}" id="rhea-panel-summary">`;
    summaryPanel += renderRheaSummarySection(runsByModel);
    summaryPanel += '</div>';

    // Build one panel per model (with optional version sub-tabs)
    let modelPanels = '';
    for (const [modelKey, runs] of Object.entries(runsByModel)) {
        const slug = _rheaModelSlug(modelKey);
        const isActive = activeRheaTab === slug || activeRheaTab === modelKey;
        modelPanels += `<div class="rhea-inner-panel ${isActive ? '' : 'hidden'}" id="rhea-panel-${slug}">`;
        modelPanels += _buildRheaModelPanel(modelKey, runs);
        modelPanels += '</div>';
    }

    container.innerHTML = tabBar + summaryPanel + modelPanels;

    const pdfBtn = document.getElementById('btn-rhea-pdf');
    if (pdfBtn) pdfBtn.classList.remove('hidden');
}

function switchRheaInnerTab(slugOrKey) {
    // Accept both slug form and raw model key
    activeRheaTab = slugOrKey;
    document.querySelectorAll('.rhea-inner-panel').forEach(p => p.classList.add('hidden'));
    const target = slugOrKey === 'summary'
        ? document.getElementById('rhea-panel-summary')
        : document.getElementById(`rhea-panel-${slugOrKey}`);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.rhea-inner-tab').forEach(btn => btn.classList.remove('rhea-inner-tab-active'));
    event?.currentTarget?.classList.add('rhea-inner-tab-active');
}

// Builds the content panel for a single model (with version sub-tabs if needed)
function _buildRheaModelPanel(modelKey, runs) {
    let html = '';

    if (runs.length > 1) {
        const activeVersionId = activeRheaModelVersions[modelKey];

        // Version sub-tab bar
        html += '<div class="rhea-version-tabbar">';
        for (const run of runs) {
            const isActive = activeVersionId === run.run_id;
            html += `<button class="rhea-version-tab ${isActive ? 'rhea-version-tab-active' : ''}" `
                + `onclick="switchRheaModelVersion('${escapeHtml(modelKey)}', '${run.run_id}', this)">`
                + `Run ${run.llm_run_id} &nbsp;·&nbsp; ${run.ts || ''}</button>`;
        }
        html += '</div>';

        // One content panel per version
        for (const run of runs) {
            const isActive = activeVersionId === run.run_id;
            html += `<div class="rhea-version-panel ${isActive ? '' : 'hidden'}" id="rhea-vp-${run.run_id}">`;
            html += _buildRheaDetailHtml(run, true);
            html += '</div>';
        }
    } else {
        html += _buildRheaDetailHtml(runs[0], true);
    }

    return html;
}

function switchRheaModelVersion(modelKey, runId, btn) {
    // run_id is a number in state but arrives as a string from onclick attributes
    runId = isNaN(+runId) ? runId : +runId;
    activeRheaModelVersions[modelKey] = runId;
    const slug = _rheaModelSlug(modelKey);
    const modelPanel = document.getElementById(`rhea-panel-${slug}`);
    if (!modelPanel) return;

    modelPanel.querySelectorAll('.rhea-version-panel').forEach(p => p.classList.add('hidden'));
    const target = document.getElementById(`rhea-vp-${runId}`);
    if (target) target.classList.remove('hidden');

    modelPanel.querySelectorAll('.rhea-version-tab').forEach(b => b.classList.remove('rhea-version-tab-active'));
    if (btn) btn.classList.add('rhea-version-tab-active');

    // Keep activeRheaRun in sync for adversarial engine
    appState.activeRheaRun = runId;
}

// hideModelName: true when called from model panel (model name is already in the tab label)
function _buildRheaDetailHtml(run, hideModelName = false) {
    const data = run.result;
    if (!data) return '';

    const summary = data.summary || {};
    const total      = summary.total || 0;
    const passed     = summary.passed || 0;
    const failed     = summary.failed || 0;
    const scored     = summary.scored_points ?? 0;
    const max        = summary.max_points || 0;
    const pointsRate = summary.points_rate ?? 0;
    const penaltyPts = summary.penalty_points ?? 0;
    const primaryRate  = max > 0 ? pointsRate : (summary.pass_rate || 0);
    const primaryColor = primaryRate >= 80 ? '#16a34a' : primaryRate >= 50 ? '#ca8a04' : '#dc2626';
    const penaltyBadge = penaltyPts < 0
        ? `<span class="rhea-penalty-badge">${penaltyPts} pts penalty</span>`
        : '';

    let html = `
        <div class="rhea-detail-block">
            <div class="rhea-detail-block-header">
                <div class="rhea-detail-metrics">
                    <div class="rhea-metric-group">
                        <span class="rhea-metric-value text-gray-800">${total}</span>
                        <span class="rhea-metric-label">Criteria</span>
                    </div>
                    <div class="rhea-metric-group">
                        <span class="rhea-metric-value text-green-600">${passed}</span>
                        <span class="rhea-metric-label">Passed</span>
                    </div>
                    <div class="rhea-metric-group">
                        <span class="rhea-metric-value text-red-600">${failed}</span>
                        <span class="rhea-metric-label">Failed</span>
                    </div>
                    <div class="rhea-metric-divider"></div>
                    <div class="rhea-metric-group rhea-metric-pts">
                        <span class="rhea-metric-pts-value">${scored} / ${max} pts</span>
                        <span class="rhea-metric-label">${max > 0 ? pointsRate + '%' : (summary.pass_rate || 0) + '%'} score</span>
                    </div>
                    ${penaltyBadge ? `<div class="rhea-metric-group">${penaltyBadge}</div>` : ''}
                </div>
                <div class="rhea-detail-block-actions">
                    <span style="color:${primaryColor}" class="rhea-metric-score-pill">${primaryRate}%</span>
                    <button class="rhea-detail-delete-btn" onclick="deleteRheaRunById('${run.run_id}')" title="Delete this run">✕</button>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table class="eval-table">
                    <thead><tr>
                        <th>Criteria</th>
                        <th class="rhea-th-pts">Pts</th>
                        <th class="rhea-th-status">Status</th>
                        <th>Reason</th>
                    </tr></thead>
                    <tbody>`;

    for (const ev of (data.evaluations || [])) {
        const badge = ev.status === 'PASS' ? 'badge-pass' : 'badge-fail';
        const pts = ev.points ?? 0;
        const isNegRubric = pts < 0;
        const effectivePts = ev.status === 'PASS' ? pts : 0;
        const ptsDisplay = pts === 0 && !isNegRubric ? '—'
            : effectivePts < 0 ? `<span class="text-red-600 font-semibold">${effectivePts}</span>`
            : effectivePts > 0 ? `<span class="text-green-700 font-semibold">+${effectivePts}</span>`
            : `<span class="text-gray-400">0</span>`;
        html += `
            <tr class="${isNegRubric ? 'rhea-row-negative' : ''}">
                <td class="text-gray-700">${escapeHtml(ev.criteria)}</td>
                <td class="text-center text-xs font-medium">${ptsDisplay}</td>
                <td><span class="${badge}">${ev.status}</span></td>
                <td class="text-gray-500 text-xs rhea-reason-cell">${escapeHtml(ev.reason || '—')}</td>
            </tr>`;
    }

    html += '</tbody></table></div></div>';
    return html;
}

// runsByModel: { modelKey: [run, ...] } — summary shows latest run per model
function renderRheaSummarySection(runsByModel) {
    if (!runsByModel) runsByModel = _groupRheaRunsByModel();
    if (Object.keys(runsByModel).length === 0) return '';

    // Latest run per model
    const latestRuns = Object.values(runsByModel).map(runs => runs[runs.length - 1]);

    let html = '<div class="rhea-summary-section">';

    if (latestRuns.length > 1) {
        html += '<div class="rhea-comparison-header">';
        html += '<h3 class="rhea-comparison-title">Summary — All Models</h3>';
        html += '</div>';
    }

    // Side-by-side summary cards — one per model (latest run)
    html += '<div class="rhea-summary-row">';
    for (const run of latestRuns) {
        const summary = run.result?.summary || {};
        const total      = summary.total || 0;
        const passed     = summary.passed || 0;
        const failed     = summary.failed || 0;
        const passRate   = summary.pass_rate || 0;
        const scored     = summary.scored_points ?? 0;
        const max        = summary.max_points || 0;
        const pointsRate = summary.points_rate ?? 0;
        const penaltyPts = summary.penalty_points ?? 0;
        const penaltyMax = summary.penalty_max ?? 0;

        const primaryRate  = max > 0 ? pointsRate : passRate;
        const primaryColor = primaryRate >= 80 ? 'text-green-600' : primaryRate >= 50 ? 'text-yellow-600' : 'text-red-600';

        const penaltyBadge = penaltyPts < 0
            ? `<span class="rhea-penalty-badge" title="Penalties from failed negative rubrics">${penaltyPts} pts penalty</span>`
            : '';

        html += `
            <div class="rhea-summary-card">
                <div class="result-card-header">
                    <h3 class="font-semibold text-gray-800">${escapeHtml(run.result?.model_name || run.model_name || run.model_key)}</h3>
                    <div class="flex items-center gap-2">
                        ${penaltyBadge}
                        <span class="${primaryColor} text-sm font-bold">${primaryRate}% score</span>
                    </div>
                </div>
                <div class="rhea-stats-row">
                    <div class="summary-stat">
                        <div class="value text-gray-800">${total}</div>
                        <span class="label">Criteria</span>
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
                        <span class="rhea-points-value" title="Max achievable: ${max} pts${penaltyMax < 0 ? ' | Max penalty: ' + penaltyMax + ' pts' : ''}">${scored} / ${max} pts</span>
                        <span class="rhea-points-pct" title="Criteria count pass rate: ${passRate}%">${pointsRate}%</span>
                    </div>
                </div>
            </div>`;
    }
    html += '</div>';

    // Comparison table only when there are multiple models
    if (latestRuns.length > 1) {
        html += renderRheaComparisonTable(latestRuns);
    }

    html += '</div>';
    return html;
}

function renderRheaComparisonTable(runs) {
    const maxRows = Math.max(...runs.map(r => (r.result?.evaluations || []).length));
    if (maxRows === 0) return '';

    let html = '<div class="overflow-x-auto mt-4">';
    html += '<table class="eval-table rhea-multi-table rhea-comparison-table">';
    html += '<thead><tr>';
    html += '<th class="rhea-th-criteria">Criteria</th>';
    html += '<th class="rhea-th-pts">Pts</th>';
    for (const run of runs) {
        html += `<th class="rhea-th-status">${escapeHtml(run.result?.model_name || run.model_name || run.model_key)}</th>`;
    }
    html += '</tr></thead>';
    html += '<tbody>';

    for (let i = 0; i < maxRows; i++) {
        const firstEv = (runs[0].result?.evaluations || [])[i];
        const pts = firstEv?.points ?? 0;
        const isNegRubric = pts < 0;
        const rowClass = isNegRubric ? 'rhea-row-negative' : '';
        const ptsDisplay = pts === 0 && !isNegRubric ? '—'
            : pts < 0 ? `<span class="text-red-600 font-semibold">${pts}</span>`
            : `<span class="text-green-700 font-semibold">+${pts}</span>`;

        html += `<tr class="${rowClass}">`;
        html += `<td class="text-gray-700 rhea-criteria-cell">${escapeHtml(firstEv?.criteria || '—')}</td>`;
        html += `<td class="text-center text-xs font-medium">${ptsDisplay}</td>`;

        for (const run of runs) {
            const ev = (run.result?.evaluations || [])[i];
            if (ev) {
                const badge = ev.status === 'PASS' ? 'badge-pass' : 'badge-fail';
                html += `<td class="text-center"><span class="${badge}">${ev.status}</span></td>`;
            } else {
                html += '<td class="text-center text-gray-400">—</td>';
            }
        }
        html += '</tr>';
    }

    // Totals row
    html += '<tr class="rhea-totals-row">';
    html += `<td colspan="2" class="font-semibold text-gray-700 text-sm">Total Score</td>`;
    for (const run of runs) {
        const summary = run.result?.summary || {};
        const scored = summary.scored_points ?? 0;
        const max    = summary.max_points || 0;
        const rate   = summary.points_rate ?? 0;
        const colorClass = rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-yellow-600' : 'text-red-600';
        html += `<td class="text-center font-bold ${colorClass} text-sm">${scored}/${max}<br><span class="text-xs">${rate}%</span></td>`;
    }
    html += '</tr>';

    html += '</tbody></table></div>';
    return html;
}

async function deleteRheaRunById(runId) {
    // run_id is a number in state but arrives as a string from onclick attributes
    runId = isNaN(+runId) ? runId : +runId;
    try {
        await fetch(`/api/runs/rhea/${runId}`, { method: 'DELETE' });
        const deleted = appState.rheaRuns.find(r => r.run_id === runId);
        appState.rheaRuns = appState.rheaRuns.filter(r => r.run_id !== runId);

        if (deleted) {
            const modelKey = deleted.model_key;
            const remaining = appState.rheaRuns.filter(r => r.model_key === modelKey);
            if (remaining.length === 0) {
                // No more runs for this model — clean up version state and go to Summary
                delete activeRheaModelVersions[modelKey];
                const slug = _rheaModelSlug(modelKey);
                if (activeRheaTab === slug || activeRheaTab === modelKey) {
                    activeRheaTab = 'summary';
                }
            } else if (activeRheaModelVersions[modelKey] === runId) {
                // Deleted the selected version — fall back to latest
                activeRheaModelVersions[modelKey] = remaining[remaining.length - 1].run_id;
            }
        }

        renderRheaRunTabs();
        showToast('Run deleted.', 'success');
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
    }
}


async function downloadRheaPDF() {
    if (appState.rheaRuns.length === 0) {
        showToast('No Rhea results to export.', 'warn');
        return;
    }

    const btn = document.getElementById('btn-rhea-pdf');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    // Build rhea_results with ALL runs (deduplicated by model_key, last run wins)
    const rhea_results = {};
    for (const run of appState.rheaRuns) {
        const key = run.model_key || run.run_id;
        rhea_results[key] = run.result;
    }

    try {
        const res = await fetch('/api/rhea/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rhea_results })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rhea_evaluation_${_dlTimestamp()}.pdf`;
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
    if (includeRhea && appState.rheaRuns.length > 0) {
        // Send the active Rhea run's result
        const activeRheaRun = appState.rheaRuns.find(r => r.run_id === appState.activeRheaRun)
            || appState.rheaRuns[appState.rheaRuns.length - 1];
        if (activeRheaRun) {
            body.rhea_results = { [activeRheaRun.model_key || 'model']: activeRheaRun.result };
        }
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

function openSystemPromptsPanel() {
    document.getElementById('sp-panel-overlay').style.display = 'flex';
    loadSystemPrompts();
}

function closeSystemPromptsPanel() {
    document.getElementById('sp-panel-overlay').style.display = 'none';
}

function handleSpPanelOverlayClick(e) {
    if (e.target === document.getElementById('sp-panel-overlay')) closeSystemPromptsPanel();
}

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
function _dlTimestamp() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

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

// ── Settings Modal ────────────────────────────────────────────────────────────

// ─── Settings Modal ───
const SK_PROVIDERS = [
    { id: 'anthropic', envKey: 'ANTHROPIC_API_KEY' },
    { id: 'openai',    envKey: 'OPENAI_API_KEY' },
    { id: 'google',    envKey: 'GOOGLE_AI_API_KEY' },
];

function openSettingsModal() {
    document.getElementById('settings-modal').style.display = 'flex';
    loadSettings();
}

function closeSettingsModal() {
    document.getElementById('settings-modal').style.display = 'none';
    SK_PROVIDERS.forEach(p => {
        const inp = document.getElementById('key-' + p.id);
        if (inp) inp.value = '';
        _hideInputRow(p.id);
    });
}

function handleSettingsOverlayClick(e) {
    if (e.target === document.getElementById('settings-modal')) closeSettingsModal();
}

async function loadSettings() {
    try {
        const [keysRes, modelsRes] = await Promise.all([
            fetch('/api/settings/keys'),
            fetch('/api/settings/analysis-models'),
        ]);
        const keysData   = await keysRes.json();
        const modelsData = await modelsRes.json();
        _applyAllKeyStatuses(keysData);
        _applyAnalysisModels(modelsData.models || {});
    } catch (_) {}
}

function _applyAnalysisModels(models) {
    ['prompt', 'rubric', 'rhea'].forEach(task => {
        const sel = document.getElementById('model-select-' + task);
        if (sel && models[task]) sel.value = models[task];
    });
}

async function saveAnalysisModel(task, modelId) {
    try {
        await fetch('/api/settings/analysis-models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [task]: modelId }),
        });
        showToast(`Model updated for ${task} analysis.`, 'success');
    } catch (e) {
        showToast('Failed to save model preference.', 'error');
    }
}

function _applyAllKeyStatuses(data) {
    _applyKeyRow('anthropic', data.ANTHROPIC_API_KEY);
    _applyKeyRow('openai',    data.OPENAI_API_KEY);
    _applyKeyRow('google',    data.GOOGLE_AI_API_KEY);
    _updateHeaderKeyIndicator(data);
}

function _applyKeyRow(provider, info) {
    const badge   = document.getElementById('sk-badge-' + provider);
    const actions = document.getElementById('sk-actions-' + provider);
    const inputRow = document.getElementById('sk-input-' + provider);
    if (!badge) return;

    if (info && info.set) {
        badge.textContent = info.masked || '••••••••';
        badge.className = 'sk-badge sk-badge-set';
        if (actions) actions.classList.remove('hidden');
        if (inputRow) inputRow.classList.add('hidden');
    } else {
        badge.textContent = 'Not set';
        badge.className = 'sk-badge sk-badge-unset';
        if (actions) actions.classList.add('hidden');
        // auto-open input when not set
        if (inputRow) inputRow.classList.remove('hidden');
    }
}

function editKey(provider) {
    const inputRow = document.getElementById('sk-input-' + provider);
    if (inputRow) {
        inputRow.classList.remove('hidden');
        const inp = document.getElementById('key-' + provider);
        if (inp) { inp.value = ''; inp.focus(); }
    }
}

function cancelEdit(provider) {
    _hideInputRow(provider);
}

function _hideInputRow(provider) {
    const inputRow = document.getElementById('sk-input-' + provider);
    const actions  = document.getElementById('sk-actions-' + provider);
    const badge    = document.getElementById('sk-badge-' + provider);
    // only hide if key is already set (otherwise keep input visible)
    if (badge && badge.classList.contains('sk-badge-set')) {
        if (inputRow) inputRow.classList.add('hidden');
    }
    const inp = document.getElementById('key-' + provider);
    if (inp) inp.value = '';
}

async function saveSingleKey(envKey, provider) {
    const inp = document.getElementById('key-' + provider);
    const value = inp ? inp.value.trim() : '';
    if (!value) {
        showToast('Please enter a key value.', 'warn');
        if (inp) inp.focus();
        return;
    }
    try {
        const res = await fetch('/api/settings/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [envKey]: value }),
        });
        const data = await res.json();
        if (data.status === 'ok') {
            showToast('Key saved successfully.', 'success');
            await loadSettings();
        } else {
            showToast('Failed to save key.', 'error');
        }
    } catch (e) {
        showToast('Error saving key: ' + e.message, 'error');
    }
}

async function deleteApiKey(envKey, provider) {
    try {
        const res = await fetch(`/api/settings/keys/${envKey}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'ok') {
            showToast('Key removed.', 'success');
            _applyAllKeyStatuses(data.keys);
        } else {
            showToast('Failed to remove key.', 'error');
        }
    } catch (e) {
        showToast('Error removing key: ' + e.message, 'error');
    }
}

async function deleteAllApiKeys() {
    try {
        const res = await fetch('/api/settings/keys/all', { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'ok') {
            showToast('All API keys removed.', 'success');
            _applyAllKeyStatuses(data.keys);
        } else {
            showToast('Failed to remove keys.', 'error');
        }
    } catch (e) {
        showToast('Error removing keys: ' + e.message, 'error');
    }
}

function _updateHeaderKeyIndicator(data) {
    const dot = document.getElementById('settings-keys-indicator');
    if (!dot) return;
    const allSet  = data.ANTHROPIC_API_KEY?.set && data.OPENAI_API_KEY?.set && data.GOOGLE_AI_API_KEY?.set;
    const someSet = data.ANTHROPIC_API_KEY?.set || data.OPENAI_API_KEY?.set || data.GOOGLE_AI_API_KEY?.set;
    dot.classList.remove('settings-keys-missing', 'settings-keys-partial', 'settings-keys-ok');
    if (allSet)       { dot.classList.add('settings-keys-ok');      dot.title = 'All API keys configured'; }
    else if (someSet) { dot.classList.add('settings-keys-partial'); dot.title = 'Some API keys missing'; }
    else              { dot.classList.add('settings-keys-missing'); dot.title = 'API keys not configured'; }
}

// ─── Expert Profiles ─────────────────────────────────────────────────────────

let _expertModalMode = 'add'; // 'add' | 'edit'

function renderExpertBar(experts, activeId) {
    const container = document.getElementById('expert-chips');
    if (!container) return;

    if (!experts || experts.length === 0) {
        container.innerHTML = `<span class="expert-no-selection">No experts yet — add one to start</span>`;
        return;
    }

    container.innerHTML = experts.map(e => {
        const initials = e.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const isActive = e.id === activeId;
        return `
        <div class="expert-chip ${isActive ? 'active' : ''}" onclick="selectExpert('${e.id}')" title="Switch to ${escapeHtml(e.name)}">
            <div class="expert-chip-avatar">${escapeHtml(initials)}</div>
            <span>${escapeHtml(e.name)}</span>
            <div class="expert-chip-actions" onclick="event.stopPropagation()">
                <button class="expert-chip-action-btn" onclick="openEditExpertModal('${e.id}', ${JSON.stringify(e.name)})" title="Rename">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="expert-chip-action-btn danger" onclick="deleteExpert('${e.id}', ${JSON.stringify(e.name)})" title="Delete">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');
}

function openAddExpertModal() {
    _expertModalMode = 'add';
    document.getElementById('expert-modal-title').textContent = 'Add Expert';
    document.getElementById('expert-modal-id').value = '';
    document.getElementById('expert-modal-name').value = '';
    document.getElementById('expert-modal-error').textContent = '';
    document.getElementById('expert-modal-error').classList.add('hidden');
    document.getElementById('expert-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('expert-modal-name').focus(), 50);
}

function openEditExpertModal(id, name) {
    _expertModalMode = 'edit';
    document.getElementById('expert-modal-title').textContent = 'Rename Expert';
    document.getElementById('expert-modal-id').value = id;
    document.getElementById('expert-modal-name').value = name;
    document.getElementById('expert-modal-error').textContent = '';
    document.getElementById('expert-modal-error').classList.add('hidden');
    document.getElementById('expert-modal').style.display = 'flex';
    setTimeout(() => {
        const inp = document.getElementById('expert-modal-name');
        inp.focus();
        inp.select();
    }, 50);
}

function closeExpertModal() {
    document.getElementById('expert-modal').style.display = 'none';
}

function expertModalBackdropClick(event) {
    if (event.target === document.getElementById('expert-modal')) {
        closeExpertModal();
    }
}

async function saveExpertModal() {
    const name = document.getElementById('expert-modal-name').value.trim();
    const errorEl = document.getElementById('expert-modal-error');
    if (!name) {
        errorEl.textContent = 'Name is required.';
        errorEl.classList.remove('hidden');
        return;
    }
    errorEl.classList.add('hidden');

    try {
        if (_expertModalMode === 'add') {
            const res = await fetch('/api/experts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error || 'Failed to create expert.';
                errorEl.classList.remove('hidden');
                return;
            }
            closeExpertModal();
            showToast(`Expert "${name}" created.`, 'success');
            // Auto-select newly created expert
            await selectExpert(data.id);
        } else {
            const id = document.getElementById('expert-modal-id').value;
            const res = await fetch(`/api/experts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error || 'Failed to rename expert.';
                errorEl.classList.remove('hidden');
                return;
            }
            closeExpertModal();
            showToast(`Renamed to "${name}".`, 'success');
            // Re-render bar (no data switch, just rename)
            const statusRes = await fetch('/api/experts');
            const statusData = await statusRes.json();
            renderExpertBar(statusData.experts, statusData.active_expert_id);
        }
    } catch (e) {
        errorEl.textContent = 'Network error: ' + e.message;
        errorEl.classList.remove('hidden');
    }
}

async function selectExpert(id) {
    try {
        showLoading('Switching expert profile…', 'Loading saved data');
        const res = await fetch(`/api/experts/${id}/select`, { method: 'POST' });
        const data = await res.json();
        hideLoading();
        if (!res.ok) {
            showToast(data.error || 'Failed to switch expert.', 'error');
            return;
        }
        // Reset all active run selections
        appState.activeLLMModel = null;
        appState.activeLLMRun = {};
        appState.activePromptRun = null;
        appState.activeRubricRun = null;
        appState.activeRheaRun = null;
        // Apply full status (includes expert data)
        updateStatus(data);
        renderExpertBar(data.experts, data.active_expert_id);
        // Restore runs
        appState.llmRuns = data.llm_runs || {};
        const firstKey = MODEL_ORDER.find(k => (appState.llmRuns[k] || []).length > 0);
        if (firstKey) {
            appState.activeLLMModel = firstKey;
            const runs = appState.llmRuns[firstKey];
            appState.activeLLMRun[firstKey] = runs[runs.length - 1].run_id;
        }
        renderAllLLMTabs();
        updateRheaModelSelect();
        appState.promptRuns = data.prompt_runs || [];
        if (appState.promptRuns.length > 0) {
            appState.activePromptRun = appState.promptRuns[appState.promptRuns.length - 1].run_id;
        }
        renderPromptRunTabs();
        appState.rubricRuns = data.rubric_runs || [];
        if (appState.rubricRuns.length > 0) {
            appState.activeRubricRun = appState.rubricRuns[appState.rubricRuns.length - 1].run_id;
        }
        renderRubricRunTabs();
        appState.rheaRuns = data.rhea_runs || [];
        if (appState.rheaRuns.length > 0) {
            appState.activeRheaRun = appState.rheaRuns[appState.rheaRuns.length - 1].run_id;
        }
        renderRheaRunTabs();
        showToast(`Switched to "${data.experts?.find(e => e.id === id)?.name || 'expert'}".`, 'success');
    } catch (e) {
        hideLoading();
        showToast('Error switching expert: ' + e.message, 'error');
    }
}

async function deleteExpert(id, name) {
    if (!confirm(`Delete expert "${name}"? Their data will be permanently removed.`)) return;
    try {
        const res = await fetch(`/api/experts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Failed to delete expert.', 'error');
            return;
        }
        showToast(`Expert "${name}" deleted.`, 'success');
        renderExpertBar(data.experts, data.active_expert_id);
        // If active expert changed, reload store
        if (data.active_expert_id !== id) {
            await fetchStatus();
        }
    } catch (e) {
        showToast('Error deleting expert: ' + e.message, 'error');
    }
}

