/* NutriTrack - app.js */

// ── State ──────────────────────────────────────────────────────────────────
let activeTab = 'text';
let imageData = null;  // { base64, mediaType }
let lastResult = null; // last nutrient analysis
let viewDate = todayKey(); // 'YYYY-MM-DD'

// ── Helpers ────────────────────────────────────────────────────────────────
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(key) {
  const d = new Date(key + 'T12:00:00');
  if (key === todayKey()) return 'Today — ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (key === yest.toISOString().slice(0, 10)) return 'Yesterday — ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function g(v) { return (v ?? 0) + 'g'; }
function mg(v) { return (v ?? 0) + 'mg'; }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

// ── Storage ────────────────────────────────────────────────────────────────
const STORE_KEY = 'nutritrack_log';

function getLog() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

function saveLog(log) {
  localStorage.setItem(STORE_KEY, JSON.stringify(log));
}

function getEntries(dateKey) {
  return getLog()[dateKey] || [];
}

function addEntry(dateKey, entry) {
  const log = getLog();
  if (!log[dateKey]) log[dateKey] = [];
  log[dateKey].push(entry);
  saveLog(log);
}

function deleteEntry(dateKey, id) {
  const log = getLog();
  if (!log[dateKey]) return;
  log[dateKey] = log[dateKey].filter(e => e.id !== id);
  saveLog(log);
}

// ── API Key ────────────────────────────────────────────────────────────────
function getApiKey() { return localStorage.getItem('nutritrack_api_key') || ''; }
function setApiKey(k) { localStorage.setItem('nutritrack_api_key', k); }

function updateApiStatus() {
  const key = getApiKey();
  const dot = document.getElementById('api-dot');
  const label = document.getElementById('api-status');
  if (key) { dot.classList.add('connected'); label.textContent = 'API connected'; }
  else { dot.classList.remove('connected'); label.textContent = 'No API key'; }
}

// ── Modal ──────────────────────────────────────────────────────────────────
function initModal() {
  const overlay = document.getElementById('modal-overlay');
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-save-key');

  if (getApiKey()) {
    overlay.classList.remove('open');
    return;
  }

  btn.addEventListener('click', () => {
    const key = input.value.trim();
    if (!key.startsWith('sk-ant')) { alert('That doesn\'t look like an Anthropic key. It should start with sk-ant-'); return; }
    setApiKey(key);
    overlay.classList.remove('open');
    updateApiStatus();
    showToast('API key saved ✓');
  });
}

// ── Tab switching ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + activeTab));
      document.getElementById('error-msg').style.display = 'none';
    });
  });
}

// ── Image upload ───────────────────────────────────────────────────────────
function initImageUpload() {
  const drop = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('img-preview');

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { showError('Image too large — max 5 MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      imageData = { base64, mediaType: file.type };
      preview.src = dataUrl;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
}

// ── Analyze ────────────────────────────────────────────────────────────────
async function analyzeFood() {
  const apiKey = getApiKey();
  if (!apiKey) {
    document.getElementById('modal-overlay').classList.add('open');
    return;
  }

  const btn = document.getElementById('btn-analyze');
  const spinner = document.getElementById('spinner');
  const btnLabel = document.getElementById('btn-label');
  const errEl = document.getElementById('error-msg');
  errEl.style.display = 'none';

  // Build payload
  let payload;
  if (activeTab === 'text') {
    const desc = document.getElementById('food-input').value.trim();
    if (!desc) { showError('Please describe a food first.'); return; }
    payload = { type: 'text', description: desc };
  } else {
    if (!imageData) { showError('Please upload a photo first.'); return; }
    payload = { type: 'image', mediaType: imageData.mediaType, data: imageData.base64 };
  }

  btn.disabled = true;
  spinner.style.display = 'block';
  btnLabel.textContent = 'Analyzing…';

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `API error ${res.status}`);

    // Extract the text from Claude's response
    const text = json.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Claude');

    // Strip markdown code fences if Claude wrapped the JSON anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const data = JSON.parse(cleaned);
    lastResult = data;
    renderResult(data);
  } catch (err) {
    showError('Analysis failed: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnLabel.textContent = '✨ Analyze Nutrients';
  }
}

function renderResult(d) {
  const card = document.getElementById('result-card');

  document.getElementById('r-name').textContent = d.foodName || 'Unknown Food';
  document.getElementById('r-serving').textContent = d.servingSize ? `Serving: ${d.servingSize}` : '';
  document.getElementById('r-calories').textContent = d.calories ?? '—';
  document.getElementById('r-carbs').textContent = d.carbohydrates?.total ?? '—';
  document.getElementById('r-protein').textContent = d.protein ?? '—';
  document.getElementById('r-fat').textContent = d.fat?.total ?? '—';
  document.getElementById('r-fiber-macro').textContent = d.carbohydrates?.fiber ?? '—';
  document.getElementById('r-sugar').textContent = g(d.carbohydrates?.sugar);
  document.getElementById('r-fiber').textContent = g(d.carbohydrates?.fiber);
  document.getElementById('r-sat').textContent = g(d.fat?.saturated);
  document.getElementById('r-unsat').textContent = g(d.fat?.unsaturated);
  document.getElementById('r-trans').textContent = g(d.fat?.trans);
  document.getElementById('r-sodium').textContent = mg(d.sodium);

  // Vitamins
  const vitSec = document.getElementById('vitamins-section');
  const vitList = document.getElementById('r-vitamins');
  if (d.vitamins?.length) {
    vitList.innerHTML = d.vitamins.map(v => `<span class="vitamin-tag">${v.name}: ${v.amount}</span>`).join('');
    vitSec.style.display = 'block';
  } else {
    vitSec.style.display = 'none';
  }

  const conf = d.confidence || 'medium';
  const notes = d.notes ? ` — ${d.notes}` : '';
  document.getElementById('r-notes').textContent = `Confidence: ${conf}${notes}. Estimates based on typical serving sizes.`;

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Add to Log ─────────────────────────────────────────────────────────────
function initAddToLog() {
  document.getElementById('btn-add-log').addEventListener('click', () => {
    if (!lastResult) return;
    const entry = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      ...lastResult,
    };
    addEntry(todayKey(), entry);
    viewDate = todayKey();
    renderLog();
    showToast('Added to today\'s log ✓');
    document.querySelector('.card:last-child').scrollIntoView({ behavior: 'smooth' });
  });
}

// ── Log Rendering ──────────────────────────────────────────────────────────
function renderLog() {
  document.getElementById('log-date-label').textContent = formatDate(viewDate);

  const entries = getEntries(viewDate);
  const empty = document.getElementById('log-empty');
  const list = document.getElementById('log-entries');
  const totals = document.getElementById('totals-bar');

  list.innerHTML = '';

  if (!entries.length) {
    empty.style.display = 'block';
    totals.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  totals.style.display = 'grid';

  let totCal = 0, totCarbs = 0, totProt = 0, totFat = 0;

  entries.forEach(e => {
    totCal += e.calories || 0;
    totCarbs += e.carbohydrates?.total || 0;
    totProt += e.protein || 0;
    totFat += e.fat?.total || 0;

    const div = document.createElement('div');
    div.className = 'log-entry';
    div.dataset.id = e.id;

    div.innerHTML = `
      <div class="log-entry-header">
        <span class="entry-time">${e.time}</span>
        <span class="entry-name">${e.foodName}</span>
        <span class="entry-cal">${e.calories} kcal</span>
        <button class="entry-delete" data-id="${e.id}" title="Remove">✕</button>
        <span class="entry-expand">▾</span>
      </div>
      <div class="log-entry-detail">
        <div class="detail-mini-grid">
          <div class="detail-mini"><div class="lbl">Carbs</div><div class="val">${g(e.carbohydrates?.total)}</div></div>
          <div class="detail-mini"><div class="lbl">Sugar</div><div class="val">${g(e.carbohydrates?.sugar)}</div></div>
          <div class="detail-mini"><div class="lbl">Fiber</div><div class="val">${g(e.carbohydrates?.fiber)}</div></div>
          <div class="detail-mini"><div class="lbl">Protein</div><div class="val">${g(e.protein)}</div></div>
          <div class="detail-mini"><div class="lbl">Total Fat</div><div class="val">${g(e.fat?.total)}</div></div>
          <div class="detail-mini"><div class="lbl">Saturated</div><div class="val">${g(e.fat?.saturated)}</div></div>
          <div class="detail-mini"><div class="lbl">Unsaturated</div><div class="val">${g(e.fat?.unsaturated)}</div></div>
          <div class="detail-mini"><div class="lbl">Trans Fat</div><div class="val">${g(e.fat?.trans)}</div></div>
          <div class="detail-mini"><div class="lbl">Sodium</div><div class="val">${mg(e.sodium)}</div></div>
          <div class="detail-mini"><div class="lbl">Serving</div><div class="val" style="font-size:.75rem">${e.servingSize || '—'}</div></div>
        </div>
      </div>
    `;

    // Toggle expand
    div.querySelector('.log-entry-header').addEventListener('click', ev => {
      if (ev.target.classList.contains('entry-delete')) return;
      div.classList.toggle('open');
    });

    // Delete
    div.querySelector('.entry-delete').addEventListener('click', ev => {
      ev.stopPropagation();
      deleteEntry(viewDate, e.id);
      renderLog();
    });

    list.appendChild(div);
  });

  document.getElementById('t-cal').textContent = Math.round(totCal);
  document.getElementById('t-carbs').textContent = Math.round(totCarbs) + 'g';
  document.getElementById('t-prot').textContent = Math.round(totProt) + 'g';
  document.getElementById('t-fat').textContent = Math.round(totFat) + 'g';
}

// ── Date nav ───────────────────────────────────────────────────────────────
function shiftDate(n) {
  const d = new Date(viewDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  viewDate = d.toISOString().slice(0, 10);
  renderLog();
}

function initDateNav() {
  document.getElementById('btn-prev').addEventListener('click', () => shiftDate(-1));
  document.getElementById('btn-next').addEventListener('click', () => shiftDate(1));
  document.getElementById('btn-today').addEventListener('click', () => { viewDate = todayKey(); renderLog(); });
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  initModal();
  initTabs();
  initImageUpload();
  updateApiStatus();
  initAddToLog();
  initDateNav();
  renderLog();

  document.getElementById('btn-analyze').addEventListener('click', analyzeFood);

  // Allow Enter in textarea to not submit (Shift+Enter = newline is default)
  document.getElementById('food-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analyzeFood(); }
  });

  // Re-check API key when clicking the status dot area
  document.querySelector('.status-dot').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('api-key-input').value = '';
  });
}

document.addEventListener('DOMContentLoaded', init);
