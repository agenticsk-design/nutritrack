/* NutriTrack - app.js (Supabase cloud storage + auth) */

// ── Supabase ───────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://zqvgsbmcxrelednrtjmk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6JjJmkv0V_7DFP9cjMwwXQ_Mk9HPp20';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ──────────────────────────────────────────────────────────────────
let activeTab = 'text';
let imageData = null;
let lastResult = null;
let viewDate = todayKey();
let currentUser = null;
let entriesCache = {}; // { 'YYYY-MM-DD': [...entries] }

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

// ── Cloud Storage ──────────────────────────────────────────────────────────
async function getEntries(dateKey) {
  if (!currentUser) return [];
  if (entriesCache[dateKey]) return entriesCache[dateKey];

  try {
    const { data, error } = await supabase
      .from('food_logs')
      .select('id, entry')
      .eq('user_id', currentUser.id)
      .eq('date', dateKey)
      .order('created_at', { ascending: true });

    if (error) throw error;
    const entries = (data || []).map(row => ({ ...row.entry, _rowId: row.id }));
    entriesCache[dateKey] = entries;
    return entries;
  } catch (err) {
    console.error('Failed to load entries:', err);
    return [];
  }
}

async function addEntry(dateKey, entry) {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase
      .from('food_logs')
      .insert({ user_id: currentUser.id, date: dateKey, entry })
      .select('id')
      .single();

    if (error) throw error;
    // Add to cache with the DB row id
    if (!entriesCache[dateKey]) entriesCache[dateKey] = [];
    entriesCache[dateKey].push({ ...entry, _rowId: data.id });
  } catch (err) {
    console.error('Failed to save entry:', err);
    throw err;
  }
}

async function deleteEntry(dateKey, entryId, rowId) {
  if (!currentUser) return;
  try {
    // rowId is the Supabase row UUID; entryId is the JS timestamp id inside entry json
    const idToDelete = rowId || entryId;
    const { error } = await supabase
      .from('food_logs')
      .delete()
      .eq('id', idToDelete)
      .eq('user_id', currentUser.id);

    if (error) throw error;
    if (entriesCache[dateKey]) {
      entriesCache[dateKey] = entriesCache[dateKey].filter(
        e => e._rowId !== idToDelete && e.id !== entryId
      );
    }
  } catch (err) {
    console.error('Failed to delete entry:', err);
    throw err;
  }
}

// ── Profile / API Key ──────────────────────────────────────────────────────
async function getApiKey() {
  if (!currentUser) return '';
  try {
    const { data } = await supabase
      .from('profiles')
      .select('anthropic_api_key')
      .eq('id', currentUser.id)
      .single();
    return data?.anthropic_api_key || '';
  } catch { return ''; }
}

async function setApiKey(key) {
  if (!currentUser) return;
  await supabase
    .from('profiles')
    .upsert({ id: currentUser.id, anthropic_api_key: key, updated_at: new Date().toISOString() });
}

async function updateApiStatus() {
  const key = await getApiKey();
  const dot = document.getElementById('api-dot');
  const label = document.getElementById('api-status');
  if (key) { dot.classList.add('connected'); label.textContent = 'API connected'; }
  else { dot.classList.remove('connected'); label.textContent = 'No API key'; }
}

// ── Auth ───────────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function setAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function onSignedIn(user) {
  currentUser = user;
  showApp();

  document.getElementById('user-email').textContent = user.email;
  document.getElementById('user-pill').style.display = 'flex';

  await updateApiStatus();

  const key = await getApiKey();
  if (!key) {
    document.getElementById('api-modal-overlay').classList.add('open');
  }

  entriesCache = {};
  viewDate = todayKey();
  await renderLog();
}

function onSignedOut() {
  currentUser = null;
  entriesCache = {};
  document.getElementById('user-pill').style.display = 'none';
  document.getElementById('log-entries').innerHTML = '';
  document.getElementById('log-empty').style.display = 'block';
  document.getElementById('totals-bar').style.display = 'none';
  document.getElementById('result-card').style.display = 'none';
  document.getElementById('api-dot').classList.remove('connected');
  document.getElementById('api-status').textContent = 'No API key';
  showAuthScreen();
}

function initAuth() {
  // Auth tab switching
  document.querySelectorAll('.auth-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.auth-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'auth-tab-' + btn.dataset.tab));
      setAuthError('');
    });
  });

  // Sign in
  document.getElementById('btn-signin').addEventListener('click', async () => {
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    if (!email || !password) { setAuthError('Please enter email and password.'); return; }

    const btn = document.getElementById('btn-signin');
    btn.disabled = true; btn.textContent = 'Signing in…';
    setAuthError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Sign In';
    if (error) setAuthError(error.message);
  });

  // Sign up
  document.getElementById('btn-signup').addEventListener('click', async () => {
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    if (!email || !password) { setAuthError('Please enter email and password.'); return; }
    if (password.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setAuthError('Passwords do not match.'); return; }

    const btn = document.getElementById('btn-signup');
    btn.disabled = true; btn.textContent = 'Creating account…';
    setAuthError('');

    const { error } = await supabase.auth.signUp({ email, password });
    btn.disabled = false; btn.textContent = 'Create Account';
    if (error) { setAuthError(error.message); return; }
    showToast('Account created! Check your email to confirm, then sign in.');
  });

  // Sign out
  document.getElementById('btn-signout').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  // Listen for auth state changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      await onSignedIn(session.user);
    } else {
      onSignedOut();
    }
  });
}

// ── API Key Modal ──────────────────────────────────────────────────────────
function initApiKeyModal() {
  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key.startsWith('sk-ant')) {
      alert("That doesn't look like an Anthropic key. It should start with sk-ant-");
      return;
    }
    await setApiKey(key);
    document.getElementById('api-modal-overlay').classList.remove('open');
    await updateApiStatus();
    showToast('API key saved ✓');
  });

  // Re-open API key modal when clicking the status dot
  document.querySelector('.status-dot').addEventListener('click', () => {
    if (!currentUser) return;
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-modal-overlay').classList.add('open');
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
  if (!currentUser) { showAuthScreen(); return; }

  const apiKey = await getApiKey();
  if (!apiKey) {
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-modal-overlay').classList.add('open');
    return;
  }

  const btn = document.getElementById('btn-analyze');
  const spinner = document.getElementById('spinner');
  const btnLabel = document.getElementById('btn-label');
  const errEl = document.getElementById('error-msg');
  errEl.style.display = 'none';

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

    const text = json.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Claude');

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
  document.getElementById('btn-add-log').addEventListener('click', async () => {
    if (!lastResult) return;
    if (!currentUser) { showAuthScreen(); return; }

    const entry = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      ...lastResult,
    };

    const btn = document.getElementById('btn-add-log');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      await addEntry(todayKey(), entry);
      viewDate = todayKey();
      await renderLog();
      showToast('Added to today\'s log ✓');
      document.querySelector('.card:last-child').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showToast('Failed to save — please try again');
    } finally {
      btn.disabled = false;
      btn.textContent = '+ Add to Today\'s Log';
    }
  });
}

// ── Log Rendering ──────────────────────────────────────────────────────────
async function renderLog() {
  document.getElementById('log-date-label').textContent = formatDate(viewDate);

  const loadingEl = document.getElementById('log-loading');
  const emptyEl = document.getElementById('log-empty');
  const listEl = document.getElementById('log-entries');
  const totalsEl = document.getElementById('totals-bar');

  loadingEl.style.display = 'flex';
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';
  totalsEl.style.display = 'none';

  const entries = await getEntries(viewDate);

  loadingEl.style.display = 'none';

  if (!entries.length) {
    emptyEl.style.display = 'block';
    return;
  }

  totalsEl.style.display = 'grid';

  let totCal = 0, totCarbs = 0, totProt = 0, totFat = 0;

  entries.forEach(e => {
    totCal += e.calories || 0;
    totCarbs += e.carbohydrates?.total || 0;
    totProt += e.protein || 0;
    totFat += e.fat?.total || 0;

    const div = document.createElement('div');
    div.className = 'log-entry';
    div.dataset.id = e.id;
    div.dataset.rowId = e._rowId || '';

    div.innerHTML = `
      <div class="log-entry-header">
        <span class="entry-time">${e.time}</span>
        <span class="entry-name">${e.foodName}</span>
        <span class="entry-cal">${e.calories} kcal</span>
        <button class="entry-delete" data-id="${e.id}" data-row-id="${e._rowId || ''}" title="Remove">✕</button>
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

    div.querySelector('.log-entry-header').addEventListener('click', ev => {
      if (ev.target.classList.contains('entry-delete')) return;
      div.classList.toggle('open');
    });

    div.querySelector('.entry-delete').addEventListener('click', async ev => {
      ev.stopPropagation();
      const entryId = ev.currentTarget.dataset.id;
      const rowId = ev.currentTarget.dataset.rowId;
      div.style.opacity = '0.5';
      try {
        await deleteEntry(viewDate, entryId, rowId);
        await renderLog();
      } catch {
        div.style.opacity = '1';
        showToast('Failed to delete — please try again');
      }
    });

    listEl.appendChild(div);
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
  const newKey = d.toISOString().slice(0, 10);
  if (newKey !== viewDate) {
    viewDate = newKey;
    renderLog();
  }
}

function initDateNav() {
  document.getElementById('btn-prev').addEventListener('click', () => shiftDate(-1));
  document.getElementById('btn-next').addEventListener('click', () => shiftDate(1));
  document.getElementById('btn-today').addEventListener('click', () => {
    if (viewDate !== todayKey()) { viewDate = todayKey(); renderLog(); }
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  initAuth();
  initApiKeyModal();
  initTabs();
  initImageUpload();
  initAddToLog();
  initDateNav();

  // onAuthStateChange fires on load with existing session (persists across refreshes)
  // If no session, auth screen is already visible (app div is hidden by default)

  document.getElementById('btn-analyze').addEventListener('click', analyzeFood);

  document.getElementById('food-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analyzeFood(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
