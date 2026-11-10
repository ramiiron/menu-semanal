'use strict';
/* Menú de la Semana — PWA de planificación de almuerzos para Ramiro y Nicole.
   Colecciones propias en Firebase: 'menu_recetas', 'menu_despensa',
   'menu_planes' y sin config compartida con otras apps. */

const LS_KEY = 'menu-semana-v1';
const APP_VERSION = '1.0';

function ing(n, q, f) { return { n, q: q || '', f: !!f }; }
const SEED_RECIPES = [
  { id: 'r-pollo-arvejado', name: 'Pollo arvejado', ings: [ing('Pollo', '1 kg', true), ing('Arvejas', '2 tazas'), ing('Zanahoria', '2'), ing('Cebolla', '1'), ing('Ajo', '2 dientes'), ing('Arroz', '2 tazas'), ing('Aceite'), ing('Sal')] },
  { id: 'r-lentejas', name: 'Lentejas', ings: [ing('Lentejas', '2 tazas'), ing('Cebolla', '1'), ing('Zanahoria', '1'), ing('Zapallo', '1 trozo'), ing('Ajo', '2 dientes'), ing('Arroz', '1 taza'), ing('Aceite'), ing('Sal')] },
  { id: 'r-tallarines', name: 'Tallarines con salsa', ings: [ing('Tallarines', '1 paquete'), ing('Carne molida', '500 g', true), ing('Salsa de tomate', '1 frasco'), ing('Cebolla', '1'), ing('Ajo', '2 dientes'), ing('Queso rallado'), ing('Aceite')] },
  { id: 'r-arroz-pollo', name: 'Arroz con pollo', ings: [ing('Pollo', '1 kg', true), ing('Arroz', '2 tazas'), ing('Cebolla', '1'), ing('Pimentón', '1'), ing('Ajo', '2 dientes'), ing('Aceite'), ing('Sal')] },
  { id: 'r-cazuela', name: 'Cazuela de vacuno', ings: [ing('Carne de vacuno', '800 g', true), ing('Papas', '4'), ing('Zapallo', '4 trozos'), ing('Choclo', '2'), ing('Porotos verdes', '1 taza'), ing('Arroz', '½ taza'), ing('Cebolla', '1'), ing('Zanahoria', '1')] },
  { id: 'r-pescado', name: 'Pescado al horno', ings: [ing('Pescado', '4 filetes', true), ing('Papas', '4'), ing('Limón', '1'), ing('Cebolla', '1'), ing('Aceite'), ing('Sal')] }
];
function seedPantry() {
  const seen = new Map();
  SEED_RECIPES.forEach(r => r.ings.forEach(i => {
    const k = norm(i.n);
    if (!seen.has(k)) seen.set(k, { id: 'p-' + k.replace(/[^a-z0-9]+/g, '-'), name: i.n, have: false });
  }));
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Nube (Firebase) — mismo proyecto, colecciones propias ----------
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBa4XTJo47f3ZutCwIabO89SNTopQqTljc",
  authDomain: "finanzas-bugueno.firebaseapp.com",
  projectId: "finanzas-bugueno",
  storageBucket: "finanzas-bugueno.firebasestorage.app",
  messagingSenderId: "745240953305",
  appId: "1:745240953305:web:37595a80c087fef80799c8"
};
let db = null, cloudOn = false, cloudErr = '';
let currentView = 'sem';
let planUnsub = null;

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS_C = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function norm(s) { return String(s || '').trim().toLowerCase(); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

// ---------- Fechas (semana lunes–domingo) ----------
function dateISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return dateISO(d);
}
function mondayOf(iso) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dow);
  return dateISO(d);
}
function todayISO() { return dateISO(new Date()); }
function weekDays(mondayIso) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(addDays(mondayIso, i));
  return out;
}
function weekLabel(mondayIso) {
  const a = parseISO(mondayIso), b = parseISO(addDays(mondayIso, 6));
  if (a.getMonth() === b.getMonth()) return a.getDate() + ' al ' + b.getDate() + ' de ' + MESES[b.getMonth()] + ' ' + b.getFullYear();
  return a.getDate() + ' de ' + MESES[a.getMonth()] + ' al ' + b.getDate() + ' de ' + MESES[b.getMonth()] + ' ' + b.getFullYear();
}
function dayTitle(iso) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7;
  return DIAS[dow] + ' ' + d.getDate();
}

// ---------- Estado ----------
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = Object.assign({ recipes: SEED_RECIPES.slice(), pantry: seedPantry(), plans: {} }, JSON.parse(raw));
      if (!Array.isArray(s.recipes)) s.recipes = SEED_RECIPES.slice();
      if (!Array.isArray(s.pantry)) s.pantry = seedPantry();
      if (!s.plans || typeof s.plans !== 'object') s.plans = {};
      return s;
    }
  } catch (e) {}
  return { recipes: SEED_RECIPES.slice(), pantry: seedPantry(), plans: {} };
}
function persistLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}
let state = load();
let viewMonday = mondayOf(todayISO());
let editRecipeId = null; // null = sin editor; '' = receta nueva

function getPlan(wk) {
  if (!state.plans[wk]) state.plans[wk] = { days: {}, bought: [] };
  if (!state.plans[wk].days) state.plans[wk].days = {};
  if (!Array.isArray(state.plans[wk].bought)) state.plans[wk].bought = [];
  return state.plans[wk];
}
function recipeById(id) { return state.recipes.find(r => r.id === id) || null; }
function planDay(iso) {
  const wk = mondayOf(iso);
  const p = state.plans[wk];
  return (p && p.days && p.days[iso]) || null;
}
function pantryItem(name) {
  const k = norm(name);
  return state.pantry.find(p => norm(p.name) === k) || null;
}
function missingFor(iso) {
  const day = planDay(iso);
  if (!day || !day.rid) return [];
  const r = recipeById(day.rid);
  if (!r) return [];
  return r.ings.filter(i => {
    const p = pantryItem(i.n);
    return !p || !p.have;
  });
}
function defrostFor(iso) {
  const day = planDay(iso);
  if (!day || !day.rid) return [];
  const r = recipeById(day.rid);
  if (!r) return [];
  return r.ings.filter(i => i.f);
}
function weekShopping(wk) {
  const plan = getPlan(wk);
  const map = new Map();
  weekDays(wk).forEach((iso, idx) => {
    const day = plan.days[iso];
    if (!day || !day.rid) return;
    const r = recipeById(day.rid);
    if (!r) return;
    r.ings.forEach(i => {
      const p = pantryItem(i.n);
      if (p && p.have) return;
      const k = norm(i.n);
      if (!map.has(k)) map.set(k, { key: k, name: i.n, qtys: [], days: [], inPantry: !!p });
      const e = map.get(k);
      if (i.q && !e.qtys.includes(i.q)) e.qtys.push(i.q);
      if (!e.days.includes(DIAS_C[idx])) e.days.push(DIAS_C[idx]);
    });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Operaciones (nube o local) ----------
async function saveRecipe(r) {
  const i = state.recipes.findIndex(x => x.id === r.id);
  if (i >= 0) state.recipes[i] = r; else state.recipes.push(r);
  if (cloudOn && db) { try { await db.collection('menu_recetas').doc(r.id).set(r); } catch (e) {} }
  persistLocal();
}
async function deleteRecipe(id) {
  state.recipes = state.recipes.filter(r => r.id !== id);
  if (cloudOn && db) { try { await db.collection('menu_recetas').doc(id).delete(); } catch (e) {} }
  persistLocal();
}
async function savePantryItem(p) {
  const i = state.pantry.findIndex(x => x.id === p.id);
  if (i >= 0) state.pantry[i] = p; else state.pantry.push(p);
  if (cloudOn && db) { try { await db.collection('menu_despensa').doc(p.id).set(p); } catch (e) {} }
  persistLocal();
}
async function deletePantryItem(id) {
  state.pantry = state.pantry.filter(p => p.id !== id);
  if (cloudOn && db) { try { await db.collection('menu_despensa').doc(id).delete(); } catch (e) {} }
  persistLocal();
}
async function savePlan(wk) {
  const plan = getPlan(wk);
  persistLocal();
  if (cloudOn && db) { try { await db.collection('menu_planes').doc(wk).set({ days: plan.days, bought: plan.bought }); } catch (e) {} }
}
function subscribePlan(wk) {
  if (!cloudOn || !db) return;
  if (planUnsub) { try { planUnsub(); } catch (e) {} planUnsub = null; }
  planUnsub = db.collection('menu_planes').doc(wk).onSnapshot(doc => {
    if (doc.exists) {
      const data = doc.data() || {};
      state.plans[wk] = { days: data.days || {}, bought: Array.isArray(data.bought) ? data.bought : [] };
      persistLocal();
      if (currentView === 'sem') renderSemana();
      if (currentView === 'com') renderCompras();
    }
  });
}

async function initCloud() {
  try {
    if (typeof firebase === 'undefined') return;
    if (firebase.apps && firebase.apps.length) { db = firebase.firestore(); }
    else {
      firebase.initializeApp(FIREBASE_CONFIG);
      await firebase.auth().signInAnonymously();
      db = firebase.firestore();
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
    }
    cloudOn = true;
    await migrateLocalToCloud();
    subscribePlan(viewMonday);
    if (currentView === 'set') renderSettings();
    db.collection('menu_recetas').onSnapshot(snap => {
      if (!snap.empty || localStorage.getItem('menu-seeded') === '1') {
        const arr = [];
        snap.forEach(d => { const x = d.data(); x.id = d.id; arr.push(x); });
        state.recipes = arr;
        persistLocal();
      }
      renderCurrent();
    });
    db.collection('menu_despensa').onSnapshot(snap => {
      if (!snap.empty || localStorage.getItem('menu-seeded') === '1') {
        const arr = [];
        snap.forEach(d => { const x = d.data(); x.id = d.id; arr.push(x); });
        state.pantry = arr;
        persistLocal();
      }
      renderCurrent();
    });
  } catch (e) {
    cloudOn = false; db = null;
    cloudErr = (e && e.message) ? String(e.message).slice(0, 140) : 'error desconocido';
    if (currentView === 'set') renderSettings();
  }
}
async function migrateLocalToCloud() {
  try {
    if (localStorage.getItem('menu-migrated') === '1') return;
    const rs = await db.collection('menu_recetas').limit(1).get();
    const ps = await db.collection('menu_despensa').limit(1).get();
    const batch = db.batch();
    let n = 0;
    if (rs.empty) state.recipes.forEach(r => { batch.set(db.collection('menu_recetas').doc(r.id), r); n++; });
    if (ps.empty) state.pantry.forEach(p => { batch.set(db.collection('menu_despensa').doc(p.id), p); n++; });
    if (n) await batch.commit();
    localStorage.setItem('menu-migrated', '1');
    localStorage.setItem('menu-seeded', '1');
  } catch (e) {}
}

// ---------- Vista Semana ----------
function renderSemana() {
  const days = weekDays(viewMonday);
  const isCurrent = viewMonday === mondayOf(todayISO());
  let html = '<div class="monthnav"><button id="wPrev" aria-label="Semana anterior">‹</button>' +
    '<div class="mname" style="text-transform:none;font-size:15px">Semana del ' + esc(weekLabel(viewMonday)) + '</div>' +
    '<button id="wNext" aria-label="Semana siguiente">›</button></div>';

  if (isCurrent) {
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const dToday = planDay(today);
    const dTom = planDay(tomorrow);
    const defr = defrostFor(tomorrow);
    const miss = missingFor(tomorrow);
    const allOk = dTom && dTom.rid && !defr.length && !miss.length;
    html += '<div class="alertcard' + (allOk ? ' ok' : '') + '"><h2>Hoy / Mañana</h2>' +
      '<div class="aline">Hoy: <b>' + esc(dToday ? dToday.name : 'sin almuerzo anotado') + '</b></div>' +
      '<div class="aline">Mañana (' + esc(dayTitle(tomorrow)) + '): <b>' + esc(dTom ? dTom.name : 'sin almuerzo anotado') + '</b></div>';
    if (dTom && dTom.rid) {
      if (defr.length) html += '<div class="aline">❄️ Saca hoy a descongelar: <b>' + defr.map(i => esc(i.n)).join(', ') + '</b></div>';
      if (miss.length) html += '<div class="aline">🛒 Te falta para mañana: <b>' + miss.map(i => esc(i.n)).join(', ') + '</b></div>';
      if (!defr.length && !miss.length) html += '<div class="aline">✓ Tienes todo para mañana, nada que descongelar.</div>';
    }
    html += '</div>';
  }

  html += '<div class="card"><h2>Almuerzos · toca un día para elegir</h2>';
  days.forEach((iso, idx) => {
    const day = planDay(iso);
    const isToday = iso === todayISO();
    let meta = 'Toca para elegir receta';
    if (day && day.rid) {
      const miss = missingFor(iso);
      const defr = defrostFor(iso);
      const bits = [];
      if (miss.length) bits.push('faltan ' + miss.length + ': ' + miss.map(i => i.n).join(', '));
      else bits.push('tienes todos los ingredientes');
      if (defr.length) bits.push('descongelar: ' + defr.map(i => i.n).join(', '));
      meta = bits.join(' · ');
    } else if (day) {
      meta = 'Sin cocina ese día';
    }
    html += '<div class="dayrow" data-day="' + iso + '"><div class="daynum"><div class="dname">' + DIAS_C[idx] + '</div>' +
      '<div class="dnum">' + parseISO(iso).getDate() + '</div></div>' +
      '<div class="ddish"><div class="dtitle">' + esc(day ? day.name : 'Sin plan') + (isToday ? '<span class="todaybadge">HOY</span>' : '') + '</div>' +
      '<div class="dmeta">' + esc(meta) + '</div></div><div class="dchev">›</div></div>';
  });
  html += '</div>';

  const el = document.getElementById('sem');
  el.innerHTML = html;
  document.getElementById('wPrev').onclick = () => { viewMonday = addDays(viewMonday, -7); subscribePlan(viewMonday); renderSemana(); };
  document.getElementById('wNext').onclick = () => { viewMonday = addDays(viewMonday, 7); subscribePlan(viewMonday); renderSemana(); };
  el.querySelectorAll('[data-day]').forEach(row => {
    row.onclick = () => openPicker(row.getAttribute('data-day'));
  });
}

// ---------- Selector de receta para un día ----------
function openPicker(iso) {
  const picker = document.getElementById('picker');
  const recs = state.recipes.slice().sort((a, b) => a.name.localeCompare(b.name));
  let html = '<div class="sheet"><h2 style="margin:0 0 6px;font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1.6px">Almuerzo del ' + esc(dayTitle(iso)) + '</h2>';
  recs.forEach(r => {
    html += '<button class="opt" data-rid="' + r.id + '">' + esc(r.name) + '</button>';
  });
  html += '<button class="opt" data-special="Libre">Libre</button>' +
    '<button class="opt" data-special="Sobras">Sobras</button>' +
    '<button class="opt" data-special="Comer fuera">Comer fuera</button>' +
    '<button class="opt" data-clear="1" style="color:var(--red)">Quitar plan</button>' +
    '<button class="opt" data-cancel="1" style="color:var(--muted)">Cancelar</button></div>';
  picker.innerHTML = html;
  picker.style.display = 'flex';
  const close = () => { picker.style.display = 'none'; picker.innerHTML = ''; };
  picker.onclick = e => { if (e.target === picker) close(); };
  picker.querySelectorAll('[data-rid]').forEach(b => {
    b.onclick = () => {
      const r = recipeById(b.getAttribute('data-rid'));
      setPlanDay(iso, { rid: r.id, name: r.name });
      close();
    };
  });
  picker.querySelectorAll('[data-special]').forEach(b => {
    b.onclick = () => { setPlanDay(iso, { rid: null, name: b.getAttribute('data-special') }); close(); };
  });
  const clr = picker.querySelector('[data-clear]');
  if (clr) clr.onclick = () => { setPlanDay(iso, null); close(); };
  const can = picker.querySelector('[data-cancel]');
  if (can) can.onclick = close;
}
function setPlanDay(iso, val) {
  const wk = mondayOf(iso);
  const plan = getPlan(wk);
  if (val) plan.days[iso] = val; else delete plan.days[iso];
  savePlan(wk);
  renderSemana();
}

// ---------- Vista Recetas ----------
function ingsToText(ings) {
  return (ings || []).map(i => i.n + (i.q ? ', ' + i.q : '') + (i.f ? ', descongelar' : '')).join('\n');
}
function textToIngs(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(',').map(x => x.trim());
    const name = parts[0];
    const f = parts.some(p => /descongelar/i.test(p));
    const q = parts.slice(1).filter(p => !/descongelar/i.test(p)).join(', ');
    return { n: name, q, f };
  }).filter(i => i.n);
}
function renderRecetas() {
  const el = document.getElementById('rec');
  if (editRecipeId !== null) {
    const r = editRecipeId === '' ? { name: '', ings: [] } : recipeById(editRecipeId);
    el.innerHTML = '<div class="card"><h2>' + (editRecipeId === '' ? 'Nueva receta' : 'Editar receta') + '</h2>' +
      '<label style="margin-top:0">Nombre</label><input id="rName" type="text" maxlength="60" value="' + esc(r ? r.name : '') + '" placeholder="Ej: Pollo arvejado">' +
      '<label>Ingredientes (uno por línea)</label>' +
      '<textarea id="rIngs" placeholder="Pollo, 1 kg, descongelar&#10;Zanahoria, 2&#10;Arroz, 2 tazas">' + esc(r ? ingsToText(r.ings) : '') + '</textarea>' +
      '<div class="hint">Formato: <b>Ingrediente, cantidad</b> y agrega <b>descongelar</b> si hay que sacarlo el día anterior (pollo, carne, pescado).</div>' +
      '<button class="btn" id="rSave">Guardar receta</button>' +
      '<button class="btn ghost" id="rCancel">Cancelar</button>' +
      (editRecipeId !== '' ? '<button class="btn danger" id="rDelete">Eliminar receta</button>' : '') +
      '</div>';
    document.getElementById('rSave').onclick = () => {
      const name = document.getElementById('rName').value.trim();
      if (!name) { alert('Ponle un nombre a la receta.'); return; }
      const ings = textToIngs(document.getElementById('rIngs').value);
      if (!ings.length) { alert('Agrega al menos un ingrediente.'); return; }
      const rec = { id: editRecipeId === '' ? uid('r-') : editRecipeId, name, ings };
      editRecipeId = null;
      saveRecipe(rec).then(() => renderRecetas());
      renderRecetas();
    };
    document.getElementById('rCancel').onclick = () => { editRecipeId = null; renderRecetas(); };
    const del = document.getElementById('rDelete');
    if (del) del.onclick = () => {
      if (confirm('¿Eliminar esta receta? Los días que la tenían anotada quedan sin receta.')) {
        const id = editRecipeId;
        editRecipeId = null;
        deleteRecipe(id).then(() => renderRecetas());
        renderRecetas();
      }
    };
    return;
  }
  const recs = state.recipes.slice().sort((a, b) => a.name.localeCompare(b.name));
  let html = '<div class="card"><h2>' + recs.length + ' recetas</h2>';
  if (!recs.length) html += '<div class="empty">Sin recetas todavía.</div>';
  recs.forEach(r => {
    const defr = r.ings.filter(i => i.f).map(i => i.n);
    html += '<div class="dayrow" data-rec="' + r.id + '"><div class="ddish"><div class="dtitle">' + esc(r.name) + '</div>' +
      '<div class="dmeta">' + r.ings.length + ' ingredientes' + (defr.length ? ' · descongelar: ' + esc(defr.join(', ')) : '') + '</div></div><div class="dchev">›</div></div>';
  });
  html += '</div><button class="btn" id="rNew" style="margin:0 0 14px">+ Nueva receta</button>';
  el.innerHTML = html;
  el.querySelectorAll('[data-rec]').forEach(row => {
    row.onclick = () => { editRecipeId = row.getAttribute('data-rec'); renderRecetas(); };
  });
  document.getElementById('rNew').onclick = () => { editRecipeId = ''; renderRecetas(); };
}

// ---------- Vista Despensa ----------
function renderDespensa() {
  const el = document.getElementById('des');
  const items = state.pantry.slice().sort((a, b) => (a.have === b.have ? a.name.localeCompare(b.name) : a.have ? 1 : -1));
  const haveCount = state.pantry.filter(p => p.have).length;
  let html = '<div class="card"><h2>En la casa · ' + haveCount + ' de ' + state.pantry.length + '</h2>' +
    '<div class="hint" style="margin-top:0">Marca lo que tienen. Lo que falte para los almuerzos de la semana aparece solo en Compras.</div>';
  if (!items.length) html += '<div class="empty">Despensa vacía.</div>';
  items.forEach(p => {
    html += '<div class="tx"><div class="tinfo"><div class="tnote">' + esc(p.name) + '</div></div>' +
      '<button class="tgl' + (p.have ? ' on' : '') + '" data-tgl="' + p.id + '">' + (p.have ? 'Tengo ✓' : 'No tengo') + '</button>' +
      '<button class="tdel" data-delp="' + p.id + '" aria-label="Eliminar">×</button></div>';
  });
  html += '</div><div class="card"><h2>Agregar ingrediente</h2>' +
    '<input id="pNew" type="text" maxlength="40" placeholder="Ej: Champiñones">' +
    '<button class="btn" id="pAdd">Agregar a la despensa</button></div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-tgl]').forEach(b => {
    b.onclick = () => {
      const p = state.pantry.find(x => x.id === b.getAttribute('data-tgl'));
      if (p) { p.have = !p.have; savePantryItem(p); renderDespensa(); }
    };
  });
  el.querySelectorAll('[data-delp]').forEach(b => {
    b.onclick = () => {
      const p = state.pantry.find(x => x.id === b.getAttribute('data-delp'));
      if (p && confirm('¿Quitar "' + p.name + '" de la despensa?')) { deletePantryItem(p.id); renderDespensa(); }
    };
  });
  document.getElementById('pAdd').onclick = () => {
    const v = document.getElementById('pNew').value.trim();
    if (!v) return;
    if (pantryItem(v)) { alert('Ese ingrediente ya está en la despensa.'); return; }
    savePantryItem({ id: uid('p-'), name: v, have: false });
    renderDespensa();
  };
}

// ---------- Vista Compras ----------
function renderCompras() {
  const el = document.getElementById('com');
  const wk = viewMonday;
  const plan = getPlan(wk);
  const items = weekShopping(wk);
  const pending = items.filter(i => !plan.bought.includes(i.key));
  const bought = items.filter(i => plan.bought.includes(i.key));
  let html = '<div class="monthnav"><button id="cPrev" aria-label="Semana anterior">‹</button>' +
    '<div class="mname" style="text-transform:none;font-size:15px">Semana del ' + esc(weekLabel(wk)) + '</div>' +
    '<button id="cNext" aria-label="Semana siguiente">›</button></div>';
  html += '<div class="card"><h2>Lista de compras · ' + pending.length + ' por comprar</h2>';
  if (!items.length) {
    const hasPlan = Object.values(plan.days).some(d => d && d.rid);
    html += '<div class="empty">' + (hasPlan ? '✓ Tienen todo para esta semana.' : 'Anota almuerzos en la pestaña Semana y aquí aparece lo que falta.') + '</div>';
  }
  const rowFor = (i, isBought) => {
    const meta = [];
    if (i.qtys.length) meta.push(i.qtys.join(' + '));
    if (i.days.length) meta.push('para ' + i.days.join(', '));
    if (!i.inPantry) meta.push('no está en tu despensa');
    return '<div class="tx"><button class="chk' + (isBought ? ' on' : '') + '" data-buy="' + esc(i.key) + '">✓</button>' +
      '<div class="tinfo"><div class="tnote' + (isBought ? ' bought' : '') + '">' + esc(i.name) + '</div>' +
      '<div class="tmeta">' + esc(meta.join(' · ')) + '</div></div>' +
      (!i.inPantry ? '<button class="tgl" data-have="' + esc(i.name) + '">Lo tengo</button>' : '') +
      '</div>';
  };
  pending.forEach(i => { html += rowFor(i, false); });
  bought.forEach(i => { html += rowFor(i, true); });
  html += '</div>';
  if (pending.length) html += '<button class="btn" id="cShare" style="margin:0 0 14px">Compartir lista</button>';
  el.innerHTML = html;
  document.getElementById('cPrev').onclick = () => { viewMonday = addDays(viewMonday, -7); subscribePlan(viewMonday); renderCompras(); };
  document.getElementById('cNext').onclick = () => { viewMonday = addDays(viewMonday, 7); subscribePlan(viewMonday); renderCompras(); };
  el.querySelectorAll('[data-buy]').forEach(b => {
    b.onclick = () => {
      const k = b.getAttribute('data-buy');
      const idx = plan.bought.indexOf(k);
      if (idx >= 0) plan.bought.splice(idx, 1); else plan.bought.push(k);
      savePlan(wk);
      renderCompras();
    };
  });
  el.querySelectorAll('[data-have]').forEach(b => {
    b.onclick = () => {
      savePantryItem({ id: uid('p-'), name: b.getAttribute('data-have'), have: true });
      renderCompras();
    };
  });
  const share = document.getElementById('cShare');
  if (share) share.onclick = async () => {
    const text = 'Lista de compras · semana del ' + weekLabel(wk) + '\n' +
      pending.map(i => '• ' + i.name + (i.qtys.length ? ' (' + i.qtys.join(' + ') + ')' : '')).join('\n');
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      throw new Error('no-share');
    } catch (e) {
      try { await navigator.clipboard.writeText(text); alert('Lista copiada. Pégala donde quieras enviarla.'); }
      catch (e2) { alert(text); }
    }
  };
}

// ---------- Ajustes ----------
function renderSettings() {
  const el = document.getElementById('set');
  el.innerHTML =
    '<div class="card"><h2>Sincronización</h2>' +
    '<div class="hint" style="margin-top:0">' +
    (cloudOn
      ? '☁️ <b>Nube activada.</b> Lo que anoten tú o Nicole aparece en ambos teléfonos.'
      : '📱 <b>Modo local.</b> Los datos viven solo en este teléfono.') +
    ((!cloudOn && cloudErr) ? '<br><span style="color:var(--red)">No se pudo conectar: ' + esc(cloudErr) + '</span>' : '') +
    '</div></div>' +
    '<div class="card"><h2>Respaldo</h2>' +
    '<button class="btn ghost" id="sExport">Exportar datos (JSON)</button>' +
    '<button class="btn danger" id="sWipe" style="margin-top:10px">Borrar todo (recetas, despensa y planes)</button>' +
    '<div class="hint">Exporta un respaldo de vez en cuando.</div></div>' +
    '<div class="ver">Menú de la Semana · v' + APP_VERSION + '</div>';
  document.getElementById('sExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'menu-respaldo-' + todayISO() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  document.getElementById('sWipe').onclick = async () => {
    if (confirm('¿Borrar TODO? Recetas, despensa y planes de todas las semanas.') &&
        confirm('¿Seguro? No se puede deshacer.')) {
      if (cloudOn && db) {
        try {
          for (const col of ['menu_recetas', 'menu_despensa', 'menu_planes']) {
            const snap = await db.collection(col).get();
            const batch = db.batch();
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          localStorage.removeItem('menu-migrated');
        } catch (e) {}
      }
      state = { recipes: [], pantry: [], plans: {} };
      persistLocal(); renderCurrent();
    }
  };
}

// ---------- Navegación ----------
const VIEW_IDS = { sem: 'vsem', rec: 'vrec', des: 'vdes', com: 'vcom', set: 'vset' };
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.getElementById(VIEW_IDS[name]).classList.add('on');
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.getAttribute('data-v') === name));
  renderCurrent();
  window.scrollTo(0, 0);
}
function renderCurrent() {
  if (currentView === 'sem') renderSemana();
  if (currentView === 'rec') renderRecetas();
  if (currentView === 'des') renderDespensa();
  if (currentView === 'com') renderCompras();
  if (currentView === 'set') renderSettings();
}
document.querySelectorAll('nav button').forEach(b => {
  b.onclick = () => showView(b.getAttribute('data-v'));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

showView('sem');
initCloud();
checkForUpdate();
if (!window.__updWatch) window.__updWatch = setInterval(checkForUpdate, 60000);

// ---------- Actualización visible con un toque (limpieza total) ----------
async function checkForUpdate() {
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j.v || j.v === APP_VERSION || document.getElementById('updBtn')) return;
    const target = j.v;
    const b = document.createElement('button');
    b.id = 'updBtn';
    b.textContent = '↓ Hay una versión nueva — toca para actualizar';
    b.onclick = async () => {
      b.textContent = 'Actualizando…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        const names = await caches.keys();
        await Promise.all(names.map(k => caches.delete(k)));
      } catch (e) {}
      setTimeout(() => {
        window.location.replace('./index.html?upd=' + target + '-' + Date.now());
      }, 400);
    };
    document.body.appendChild(b);
  } catch (e) {}
}
