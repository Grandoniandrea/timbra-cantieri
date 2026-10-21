'use strict';

// ---------- Dati ----------
const KEY = 'timbra-cantieri.v1';
const COLORS = ['#ea580c', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ca8a04', '#64748b'];
const DEFAULT_SITES = [
  'PISA', 'SAN GIULIANO TERME', 'CASCINA', 'CALCINAIA', 'PONTEDERA',
  'MONTOPOLI', 'SANTA MARIA A MONTE', 'PONSACCO', 'CASCIANA TERME / LARI', 'CAPANNOLI',
];
// Un nuovo tocco del tag entro questo tempo dall'entrata chiede conferma prima di chiudere il turno.
const DOUBLE_TAP_MS = 2 * 60 * 1000;
const UNDO_MS = 8000;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* storage non disponibile */ }
  return {
    sites: DEFAULT_SITES.map((name, i) => ({ id: uid() + i, name, color: COLORS[i % COLORS.length] })),
    shifts: [],
    active: null,
    user: null,
  };
}
// Registro aziendale GE3CO (Google Apps Script): tutti i telefoni sono collegati in automatico.
// Le operazioni del responsabile sono protette dalla password verificata dallo script.
const APP_VERSION = 49;
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwrPn7c9W0Dl9mUZGq6Yp35uhv2wprrhOUFFB4PF50ZYtIhY2o1bVugEYrmIJh3NJf6xw/exec';
let db = load();
db.queue = db.queue || [];
db.endpoint = db.endpoint || DEFAULT_ENDPOINT;
// Codice di accesso aziendale: arriva dal link di invito (?codice=…) e accompagna ogni richiesta allo script
const ep = q => `${db.endpoint}?${q}&codice=${encodeURIComponent(db.codice || '')}`;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Impossibile salvare su questo telefono'); }
  render();
  setTimeout(flush, 0);
}
const siteById = id => db.sites.find(s => s.id === id) || { name: 'Cantiere eliminato', color: '#999' };

// ---------- Utilità ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtDate = t => new Date(t).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${pad(m % 60)}m` : `${m} min`;
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
function startOfWeek() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
// Per gli input datetime-local
const toLocalInput = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---------- Timbrature ----------
// Posizione del telefono al momento della timbratura (se l'operatore dà il permesso)
const posLabel = p => !p ? '📍 Rilevo la posizione…'
  : p.errore ? `📍 Posizione non disponibile (${esc(p.errore)}). Controlla che la localizzazione sia attiva.`
  : `📍 Posizione registrata ✓ (±${Math.round(p.acc || 0)} m)`;
// ---------- Controllo sede: si timbra solo vicino alla sede ----------
function distanza(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = d => d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(d) + ' m';
// Rileva la posizione, controlla la distanza dalla sede e poi esegue cb(pos). Altrimenti blocca la timbratura.
// Modalità prova: solo sul telefono del responsabile, per mostrare l'app fuori sede. Scade da sola.
const DEMO_ORE = 8;
const isDemo = () => !!db.adminDevice && (db.demoUntil || 0) > Date.now();
function setDemo(on) {
  db.demoUntil = on ? Date.now() + DEMO_ORE * 3600000 : 0;
  save();
  toast(on ? `Modalità prova attiva fino alle ${fmtTime(db.demoUntil)}` : 'Modalità prova disattivata');
}
async function requireSede(what, cb) {
  if (isDemo()) {
    // In prova si registra comunque la posizione, ma senza bloccare
    openDialog(`<h3>🧪 Modalità prova</h3><p>Timbratura consentita anche fuori sede…</p>`);
    $('#dlgBody .dlg-x').remove();
    const p = await getPos();
    if (dlg.open) dlg.close();
    return cb(p);
  }
  const sede = cfg().sede;
  openDialog(`<h3>📍 Verifico la posizione</h3><p>Controllo che tu sia in sede per timbrare ${esc(what)}…</p>`);
  $('#dlgBody .dlg-x').remove();
  const pos = await getPos();
  const retry = (title, msg) => openDialog(`
    <h3>${title}</h3><p>${msg}</p>
    <div class="row"><button class="btn ghost" value="">Chiudi</button><button class="btn" value="retry">Riprova</button></div>`,
    a => { if (a === 'retry') setTimeout(() => requireSede(what, cb), 50); });
  if (pos.errore) {
    return retry('📍 Posizione non disponibile',
      `Per timbrare serve la posizione del telefono (${esc(pos.errore)}). Attiva la Localizzazione e consenti l'accesso alla posizione per questo sito, poi riprova.`);
  }
  if (sede && isFinite(sede.lat)) {
    const d = distanza(sede, pos);
    if (d > sede.raggio + Math.min(pos.acc || 0, 100)) {
      return retry('🚫 Non sei in sede',
        `Sei a <b>${fmtDist(d)}</b> dalla sede (${esc(sede.nome || 'sede')}). L'${esc(what)} si timbra solo in sede.`);
    }
  }
  if (dlg.open) dlg.close();
  cb(pos);
}

function getPos() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ errore: 'non supportata' });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => resolve({ errore: e.code === 1 ? 'permesso negato' : 'segnale assente' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 });
  });
}
// La posizione (pos) arriva già verificata da requireSede()
function clockIn(siteId, pos) {
  if (db.active) return;
  db.active = { id: uid(), siteId, start: Date.now(), posIn: pos || null, demo: isDemo() || undefined };
  enqueueUpsert(Object.assign({}, db.active, { end: null }));
  save();
  return db.active;
}
function clockOut(pos) {
  if (!db.active) return null;
  const shift = { id: db.active.id || uid(), siteId: db.active.siteId, start: db.active.start, end: Date.now(),
    posIn: db.active.posIn, posOut: pos || null, demo: db.active.demo || isDemo() || undefined };
  const prevActive = db.active;
  db.shifts.unshift(shift);
  db.active = null;
  enqueueUpsert(shift);
  save();
  shift.undo = () => {
    db.shifts = db.shifts.filter(s => s.id !== shift.id);
    db.active = prevActive;
    enqueueUpsert({ id: shift.id, siteId: shift.siteId, start: shift.start, end: null, posIn: shift.posIn });
    save();
  };
  toast(`Uscita ${siteById(shift.siteId).name} · ${fmtDur(shift.end - shift.start)}`, shift.undo);
  return shift;
}

// ---------- Render ----------
let timer;
function render() {
  const bar = $('#demoBar');
  if (isDemo()) {
    bar.hidden = false;
    bar.innerHTML = `<span>🧪 <b>Modalità prova</b> fino alle ${fmtTime(db.demoUntil)}: timbri anche fuori sede, senza avvisi e senza contare le ore (solo questo telefono).</span>
      <button type="button" class="btn ghost" id="demoOff">Disattiva</button>`;
    $('#demoOff').onclick = () => setDemo(false);
  } else bar.hidden = true;
  $('#btnWho').textContent = db.user ? fullName() : 'Inserisci il tuo nome';
  // Stato in alto
  const st = $('#status');
  clearInterval(timer);
  if (db.active) {
    const site = siteById(db.active.siteId);
    st.className = 'card status active';
    st.innerHTML = `
      <small>TURNO IN CORSO</small>
      <div class="site-name">${esc(site.name)}</div>
      <div class="timer" id="timer"></div>
      <div class="bar"><span id="bar"></span></div>
      <p id="left"></p>
      <p class="gps">${posLabel(db.active.posIn)}${db.active.posIn && !db.active.posIn.errore && cfg().sede ? ' · in sede' : ''}</p>
      <p>${esc(fasciaLabel(db.active.start))} · entrata alle ${fmtTime(db.active.start)} · fine prevista alle ${fmtTime(db.active.start + cfg().oreTurno * 3600000)}</p>
      <button class="btn big danger" id="btnOut">Timbra uscita</button>`;
    const tick = () => {
      const el = $('#timer'); if (!el || !db.active) return;
      const done = Date.now() - db.active.start, tot = cfg().oreTurno * 3600000;
      el.textContent = fmtClock(done);
      $('#bar').style.width = Math.min(100, done / tot * 100) + '%';
      $('#bar').classList.toggle('over', done > tot);
      $('#left').textContent = done < tot ? `Mancano ${fmtDur(tot - done)} alle ${cfg().oreTurno} ore`
        : `${cfg().oreTurno} ore completate · ${fmtDur(done - tot)} in più`;
      document.title = `⏱ ${fmtClock(done)} · Timbra Cantieri`;
    };
    tick(); timer = setInterval(tick, 1000);
    $('#btnOut').onclick = () => requireSede('uscita', pos => { const sh = clockOut(pos); if (sh) afterClockOut(sh, false); });
  } else {
    st.className = 'card status';
    st.innerHTML = `
      <small>PRONTO A TIMBRARE</small>${(document.title = 'Timbra Cantieri', '')}
      <h2>Nessun turno attivo</h2>
      <p>Tocca <b>Entrata</b> su un cantiere, oppure passa il telefono sul tag NFC.</p>`;
  }

  // Statistiche (turni chiusi + turno in corso)
  const all = db.shifts.filter(s => !s.demo);
  if (db.active) all.push({ start: db.active.start, end: Date.now() });
  const sum = from => all.filter(s => s.start >= from).reduce((a, s) => a + (s.end - s.start), 0);
  $('#statWeek').textContent = fmtDur(sum(startOfWeek()));
  $('#statMonth').textContent = fmtDur(sum(startOfMonth()));
  const n = db.shifts.filter(s => s.start >= startOfMonth() && !s.demo).length;
  $('#statMonthN').textContent = `${n} turn${n === 1 ? 'o' : 'i'} conclus${n === 1 ? 'o' : 'i'}`;

  renderInterventi();
  renderPlan();

  // Cantieri
  const managed = !!db.endpoint;
  $('#btnAddSite').hidden = managed;
  $('#sitesNote').hidden = !managed;
  $('#foot').textContent = (managed
    ? 'Le timbrature vengono inviate al registro aziendale.'
    : 'I dati restano su questo telefono. Fai un backup ogni tanto dal menu ⋯') + ` · versione ${APP_VERSION}`;
  const shown = db.sites.filter(s => !s.hidden);
  const todayPlanned = new Set(myPlan().filter(p => p.data === isoDay(new Date())).map(p => p.cantiere));
  $('#sites').innerHTML = shown.length ? shown.map(s => {
    const here = db.active && db.active.siteId === s.id;
    return `<li>
      <span class="dot" style="background:${esc(s.color)}"></span>
      <div class="grow"><b>${esc(s.name)}</b><span>${here ? 'In corso' : todayPlanned.has(s.name) ? '📅 In programma oggi' : 'Pronto'}</span></div>
      ${managed ? '' : `<button class="icon-btn" data-edit-site="${s.id}" aria-label="Modifica ${esc(s.name)}">✎</button>`}
      <button class="btn" data-in="${s.id}" ${db.active ? 'disabled' : ''}>Entrata</button>
    </li>`;
  }).join('') : '<li class="empty">Nessun cantiere. Aggiungine uno con + Nuovo.</li>';

  // Registro
  const recent = db.shifts.slice(0, 30);
  $('#log').innerHTML = recent.length ? recent.map(s => {
    const site = siteById(s.siteId);
    return `<li ${isEmployee() ? '' : `data-edit-shift="${s.id}" style="cursor:pointer"`}>
      <span class="dot" style="background:${esc(site.color)}"></span>
      <div class="grow"><b>${esc(site.name)}</b><span>${fmtDate(s.start)} · ${(fascia(s.start) || { nome: 'Fuori orario' }).nome} · ${fmtTime(s.start)} → ${fmtTime(s.end)}</span></div>
      <span class="log-dur">${fmtDur(s.end - s.start)}${s.demo ? '<small class="prova-tag">🧪 prova · non conta</small>' : extraMin(s) ? `<small class="extra-tag">+${fmtDur(extraMin(s) * 60000)} extra</small>` : ''}</span>
    </li>`;
  }).join('') : '<li class="empty">Le tue timbrature compariranno qui.</li>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-in],[data-edit-site],[data-edit-shift]');
  if (!t) return;
  if (t.dataset.in) {
    const siteId = t.dataset.in;
    requireSede('entrata', pos => { clockIn(siteId, pos); toast(`Entrata ${siteById(siteId).name} alle ${fmtTime(Date.now())}`); });
  }
  else if (t.dataset.editSite) editSite(t.dataset.editSite);
  else if (t.dataset.editShift) editShift(t.dataset.editShift);
});

// ---------- Dialog ----------
const dlg = $('#dlg');
// Pulsante premuto nel form (su alcuni iPhone e.submitter non è affidabile)
let lastSubmitter = null;
document.addEventListener('click', e => {
  const b = e.target.closest('#dlgBody button');
  if (b && b.type !== 'button') lastSubmitter = b;
}, true);
function openDialog(html, onSubmit) {
  $('#dlgBody').innerHTML = html +
    '<button type="button" class="dlg-x" aria-label="Chiudi" onclick="var d=document.getElementById(\'dlg\');d.oncancel=null;d.close()">✕</button>';
  dlg.onclose = null;
  dlg.oncancel = null;
  lastSubmitter = null;
  $('#dlgBody').onsubmit = e => {
    const btn = e.submitter || lastSubmitter;
    lastSubmitter = null;
    if (btn && btn.value && onSubmit) {
      if (onSubmit(btn.value, new FormData($('#dlgBody'))) === false) { e.preventDefault(); }
    }
  };
  if (!dlg.open) dlg.showModal();
}

function colorPicker(current) {
  return `<div class="colors">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${c === current ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>`;
}

function editSite(id) {
  const s = id ? db.sites.find(x => x.id === id) : null;
  openDialog(`
    <h3>${s ? 'Modifica cantiere' : 'Nuovo cantiere'}</h3>
    <label>Nome<input name="name" required maxlength="60" value="${s ? esc(s.name) : ''}" autocomplete="off"></label>
    <label>Colore</label>${colorPicker(s ? s.color : COLORS[db.sites.length % COLORS.length])}
    <div class="row">
      ${s ? '<button class="btn ghost" value="delete" formnovalidate style="color:var(--danger)">Elimina</button>' : ''}
      <button class="btn ghost" value="" formnovalidate>Annulla</button>
      <button class="btn" value="save">Salva</button>
    </div>`, (action, fd) => {
    if (action === 'delete') {
      if (db.active && db.active.siteId === id) { alert('Prima chiudi il turno in corso su questo cantiere.'); return false; }
      if (!confirm(`Eliminare ${s.name}? Le timbrature già fatte restano nel registro.`)) return false;
      db.sites = db.sites.filter(x => x.id !== id);
    } else {
      const name = String(fd.get('name') || '').trim().toUpperCase();
      if (!name) return false;
      const color = fd.get('color') || COLORS[0];
      if (s) Object.assign(s, { name, color });
      else db.sites.push({ id: uid(), name, color });
    }
    save();
  });
}

function editShift(id) {
  const s = db.shifts.find(x => x.id === id);
  if (!s) return;
  openDialog(`
    <h3>Modifica timbratura</h3>
    <label>Cantiere<select name="site">${db.sites.filter(x => !x.hidden || x.id === s.siteId).map(x => `<option value="${x.id}" ${x.id === s.siteId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label>Entrata<input type="datetime-local" name="start" required value="${toLocalInput(s.start)}"></label>
    <label>Uscita<input type="datetime-local" name="end" required value="${toLocalInput(s.end)}"></label>
    <div class="row">
      <button class="btn ghost" value="delete" formnovalidate style="color:var(--danger)">Elimina</button>
      <button class="btn ghost" value="" formnovalidate>Annulla</button>
      <button class="btn" value="save">Salva</button>
    </div>`, (action, fd) => {
    if (action === 'delete') {
      if (!confirm('Eliminare questa timbratura?')) return false;
      db.shifts = db.shifts.filter(x => x.id !== id);
      enqueueDelete(id);
    } else {
      const start = new Date(fd.get('start')).getTime();
      const end = new Date(fd.get('end')).getTime();
      if (!(end > start)) { alert("L'uscita deve essere dopo l'entrata."); return false; }
      Object.assign(s, { siteId: fd.get('site') || s.siteId, start, end });
      enqueueUpsert(s);
      db.shifts.sort((a, b) => b.start - a.start);
    }
    save();
  });
}

function pickSiteForNfc(pos) {
  openDialog(`
    <h3>Dove sei oggi?</h3>
    <p>Scegli il cantiere per timbrare l'entrata.</p>
    <div class="pick">${db.sites.filter(s => !s.hidden).map(s => `<button value="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</button>`).join('')}</div>
    <button class="btn ghost" value="">Annulla</button>`, siteId => {
    clockIn(siteId, pos);
    const undo = () => { if (db.active) enqueueDelete(db.active.id); db.active = null; save(); };
    setTimeout(() => showBigOk('Entrata', siteById(siteId).name, `alle ${fmtTime(db.active.start)}`, undo), 50);
  });
}

function showBigOk(what, siteName, detail, undo) {
  $('#toast').hidden = true;
  openDialog(`
    <div class="big-ok">
      <div class="check">✓</div>
      <small>${esc(what.toUpperCase())} REGISTRATA</small>
      <strong>${esc(siteName)}</strong>
      <p>${esc(detail)}</p>
    </div>
    <button class="btn big" value="">OK</button>
    ${undo ? '<button class="btn ghost" value="undo">Annulla, ho sbagliato</button>' : ''}`,
    a => { if (a === 'undo' && undo) { undo(); toast('Annullato'); } });
}

// ---------- NFC: un solo tag, entrata/uscita automatica ----------
function handleNfc() {
  const params = new URLSearchParams(location.search);
  if (!params.has('nfc')) return;
  history.replaceState(null, '', location.pathname); // un ricarico della pagina non ri-timbra
  if (!db.active) { requireSede('entrata', pos => setTimeout(() => pickSiteForNfc(pos), 50)); return; }
  const doOut = () => requireSede('uscita', pos => {
    const shift = clockOut(pos);
    if (shift) setTimeout(() => afterClockOut(shift, true), 50);
  });
  if (Date.now() - db.active.start < DOUBLE_TAP_MS) {
    openDialog(`
      <h3>Hai appena timbrato l'entrata</h3>
      <p>Vuoi davvero chiudere il turno a ${esc(siteById(db.active.siteId).name)}?</p>
      <div class="row"><button class="btn ghost" value="">No</button><button class="btn danger" value="out">Sì, esci</button></div>`,
      () => { setTimeout(doOut, 50); });
    return;
  }
  doOut();
}

// ---------- Menu: export e backup ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fullName = () => db.user ? `${db.user.first} ${db.user.last}` : '';
function buildCsv(from) {
  const rows = [['Dipendente', 'Data', 'Cantiere', 'Entrata', 'Uscita', 'Minuti', 'Ore', 'Extra (min)', 'Motivo extra']];
  db.shifts.filter(s => s.start >= from).sort((a, b) => a.start - b.start).forEach(s => {
    const min = Math.round((s.end - s.start) / 60000);
    rows.push([fullName(), new Date(s.start).toLocaleDateString('it-IT'), siteById(s.siteId).name, fmtTime(s.start), fmtTime(s.end), min, (min / 60).toFixed(2).replace('.', ','), extraMin(s) || '', s.extra ? s.extra.motivo + (s.extra.nota ? ' – ' + s.extra.nota : '') : '']);
  });
  return '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
function csvName(label) {
  const who = fullName().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dipendente';
  return `timbrature-${who}-${label}.csv`;
}
function exportCsv() { download(csvName(new Date().toISOString().slice(0, 10)), buildCsv(0), 'text/csv'); }
// Manda le timbrature del mese (WhatsApp, email...) con la condivisione del telefono.
async function shareMonth() {
  const d = new Date();
  const label = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const name = csvName(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  const csv = buildCsv(startOfMonth());
  const file = new File([csv], name, { type: 'text/csv' });
  const tot = db.shifts.filter(s => s.start >= startOfMonth()).reduce((a, s) => a + (s.end - s.start), 0);
  const text = `Timbrature di ${fullName()} – ${label}: ${fmtDur(tot)} in totale.`;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: text, text }); } catch (e) { /* annullato */ }
  } else {
    download(name, csv, 'text/csv');
    toast('File scaricato: allegalo a WhatsApp o email');
  }
}
function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!Array.isArray(data.sites) || !Array.isArray(data.shifts)) throw new Error();
      if (!confirm('Sostituire tutti i dati attuali con quelli del backup?')) return;
      db = { sites: data.sites, shifts: data.shifts, active: data.active || null, user: data.user || db.user, endpoint: db.endpoint, queue: [] };
      resyncAll();
      save(); toast('Backup ripristinato');
    } catch (e) { alert('File di backup non valido.'); }
  };
  inp.click();
}
// Dipendente collegato: menu ridotto (invia e scarica le proprie timbrature).
// Telefono del responsabile (o non collegato): menu completo.
const isEmployee = () => !!db.endpoint && !db.adminDevice;
$('#btnMenu').onclick = () => openDialog(isEmployee() ? `
  <h3>Menu</h3>
  <p>${esc(syncStatus())}</p>
  <div class="menu">
    <button class="btn" value="share">📤 Invia le mie timbrature al responsabile (WhatsApp)</button>
    <button class="btn ghost" value="assenze">🌴 Ferie, permessi, malattia</button>
    <button class="btn ghost" value="paga">💶 Stima busta paga</button>
    <button class="btn ghost" value="modulo">📝 Modulo ore settimanale</button>
    <button class="btn ghost" value="csv">⬇︎ Scarica le mie timbrature (Excel)</button>
    <button class="btn ghost" value="">Chiudi</button>
  </div>` : `
  <h3>Menu</h3>
  <p>${esc(syncStatus())}</p>
  <div class="menu">
    ${db.endpoint ? '<button class="btn" value="admin">🔒 Area responsabile</button>' : ''}
    <button class="btn ghost" value="share">📤 Invia timbrature del mese</button>
    <button class="btn ghost" value="assenze">🌴 Ferie, permessi, malattia</button>
    <button class="btn ghost" value="paga">💶 Stima busta paga</button>
    <button class="btn ghost" value="modulo">📝 Modulo ore settimanale</button>
    <button class="btn ghost" value="csv">⬇︎ Esporta tutte le timbrature (Excel)</button>
    <button class="btn ghost" value="profile">👤 Cambia nome e cognome</button>
    <button class="btn ghost" value="backup">💾 Salva backup completo</button>
    <button class="btn ghost" value="restore">♻︎ Ripristina da backup</button>
    <button class="btn ghost" value="nfc">🏷️ Link da scrivere sul tag NFC</button>
    <button class="btn ghost" value="">Chiudi</button>
  </div>`, action => {
  if (action === 'share') shareMonth();
  if (action === 'assenze') setTimeout(myAbsences, 50);
  if (action === 'paga') setTimeout(payPick, 50);
  if (action === 'modulo') setTimeout(modPick, 50);
  if (action === 'csv') exportCsv();
  if (action === 'profile') setTimeout(() => editProfile(), 50);
  if (action === 'backup') download(`timbra-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db, null, 2), 'application/json');
  if (action === 'restore') importBackup();
  if (action === 'nfc') setTimeout(showNfcLink, 50);
  if (action === 'admin') setTimeout(adminLogin, 50);
});

// Accesso nascosto all'area responsabile: 5 tocchi veloci sul logo, oppure tenerlo premuto 2 secondi.
let logoTaps = [], logoHold;
function openAdminFromLogo() {
  logoTaps = [];
  if (!db.endpoint) return toast('Telefono non collegato al registro aziendale');
  if (navigator.vibrate) navigator.vibrate(30);
  adminLogin();
}
const logo = $('.logo');
logo.addEventListener('click', () => {
  const now = Date.now();
  logoTaps = logoTaps.filter(t => now - t < 4000).concat(now);
  if (logoTaps.length >= 5) openAdminFromLogo();
});
logo.addEventListener('pointerdown', () => { logoHold = setTimeout(openAdminFromLogo, 2000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => logo.addEventListener(ev, () => clearTimeout(logoHold)));
logo.addEventListener('contextmenu', e => e.preventDefault());
logo.draggable = false;
function showNfcLink() {
  const link = location.origin + location.pathname + '?nfc=1';
  openDialog(`
    <h3>Link per il tag NFC</h3>
    <p>Con NFC Tools: Scrivi → Aggiungi un record → URL/URI → incolla questo link.</p>
    <input readonly value="${esc(link)}" onclick="this.select()">
    <div class="row"><button class="btn ghost" value="">Chiudi</button><button class="btn" value="copy">Copia</button></div>`,
    a => { if (a === 'copy') navigator.clipboard.writeText(link).then(() => toast('Link copiato'), () => {}); });
}
$('#btnAddSite').onclick = () => editSite(null);

// ---------- Toast con Annulla ----------
let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Annulla</button>' : ''}`;
  t.hidden = false;
  if (undo) t.querySelector('button').onclick = () => { undo(); t.hidden = true; if (dlg.open) dlg.close(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? UNDO_MS : 3000);
}

// ---------- Interventi (segnalazioni da ritirare) ----------
// Il responsabile li crea e li assegna; l'operatore naviga, fa le foto prima/dopo, chiude e manda tutto su WhatsApp.
const INT_TUTTI = 'Tutti';
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const hasCoord = c => /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(String(c || ''));
function navUrl(x) {
  const dest = hasCoord(x.coord) ? x.coord.replace(/\s/g, '') : [x.indirizzo, x.localita].filter(Boolean).join(', ');
  const q = encodeURIComponent(dest);
  return isIOS() ? `https://maps.apple.com/?daddr=${q}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
}
const intWhere = x => [x.indirizzo, x.localita].filter(Boolean).join(', ');
// Foto ridotte (lato lungo max 1280 px, JPEG) per inviarle anche con poco campo
function compressImage(file, max = 1280, q = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('foto')); };
    img.src = url;
  });
}
function dataUrlToFile(d, name) {
  const [head, b64] = d.split(',');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new File([bytes], name, { type: (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg' });
}

// Operatore: scarica gli interventi assegnati a lui o a tutti
let intSeen = null;
async function syncInterventi() {
  if (!db.endpoint || !db.user || navigator.onLine === false) return;
  try {
    const res = await withTimeout(fetch(ep(`azione=interventi&nome=${encodeURIComponent(fullName())}`)), 20000);
    const out = await res.json();
    if (!out.ok || !Array.isArray(out.interventi)) return;
    const prima = new Set((db.interventi || []).map(x => x.id));
    const nuovi = out.interventi.filter(x => x.stato !== 'Fatto' && !prima.has(x.id));
    if (JSON.stringify(out.interventi) !== JSON.stringify(db.interventi)) { db.interventi = out.interventi; save(); }
    if (intSeen && nuovi.length) {
      toast(nuovi.length === 1 ? `📍 Nuovo intervento: ${intWhere(nuovi[0])}` : `📍 ${nuovi.length} nuovi interventi`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    intSeen = true;
  } catch (e) { /* offline o script da aggiornare */ }
}
setInterval(() => { if (!document.hidden) syncInterventi(); }, 60000);
const intDoneLocal = id => (db.intChiusi || {})[id];
function renderInterventi() {
  const box = $('#interventi');
  if (!box) return;
  if (!Array.isArray(db.interventi)) { box.hidden = true; return; }
  const oggi = isoDay(new Date());
  const daFare = db.interventi.filter(x => x.stato !== 'Fatto' && !intDoneLocal(x.id));
  const fatti = db.interventi.filter(x => x.stato === 'Fatto' || intDoneLocal(x.id));
  box.hidden = !daFare.length && !fatti.length;
  if (box.hidden) return;
  box.innerHTML = `<div class="sec-head"><div><small>SEGNALAZIONI</small><h2>Interventi${daFare.length ? ` <span class="badge">${daFare.length}</span>` : ''}</h2></div></div>
    <ul class="list">${daFare.map(x => `<li class="int-row" data-int="${esc(x.id)}">
      <span class="dot" style="background:#dc2626"></span>
      <div class="grow"><b>${esc(intWhere(x))}</b><span>${x.data && x.data !== oggi ? esc(dayLabel(x.data)) + ' · ' : ''}${esc(x.cosa || 'da ritirare')}${x.cliente ? ' · ' + esc(x.cliente) : ''}</span></div>
      <span class="pill">Apri</span></li>`).join('')}
    ${fatti.slice(0, 5).map(x => `<li class="int-row done" data-int="${esc(x.id)}">
      <span class="dot" style="background:var(--brand)"></span>
      <div class="grow"><b>${esc(intWhere(x))}</b><span>✅ Fatto${intDoneLocal(x.id) && x.stato !== 'Fatto' ? ' · in invio' : ''}</span></div></li>`).join('')}</ul>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-int]');
  if (t && !dlg.open) intView(t.dataset.int);
});
const intFoto = {}; // foto scattate e non ancora inviate, per intervento
function intView(id) {
  const x = (db.interventi || []).find(i => i.id === id);
  if (!x) return;
  const f = intFoto[id] || (intFoto[id] = {});
  const done = x.stato === 'Fatto' || intDoneLocal(id);
  const thumb = (k, label) => `<label class="int-photo">${f[k] ? `<img src="${f[k]}" alt="${label}"><small>${label} ✓ · tocca per rifarla</small>` : `<span>📷 ${label}</span>`}
      ${done ? '' : `<input type="file" accept="image/*" capture="environment" data-foto="${k}" hidden>`}</label>`;
  openDialog(`
    <h3>📍 Intervento</h3>
    <div class="int-info">
      <b>${esc(intWhere(x))}</b>
      ${x.cliente ? `<span>👤 ${esc(x.cliente)}</span>` : ''}
      ${x.cosa ? `<span>📦 ${esc(x.cosa)}</span>` : ''}
      ${x.note ? `<span>📝 ${esc(x.note)}</span>` : ''}
      ${x.data ? `<span>📅 ${esc(dayLabel(x.data))}</span>` : ''}
    </div>
    ${x.screenshot ? '<div id="intShot"><button class="btn ghost" value="shot" formnovalidate>🖼️ Vedi la segnalazione</button></div>' : ''}
    <a class="btn" href="${esc(navUrl(x))}" target="_blank" rel="noopener">🧭 Naviga</a>
    ${done ? '<p class="note">✅ Intervento chiuso.</p>' : `
    <div class="int-photos">${thumb('prima', 'Foto prima')}${thumb('dopo', 'Foto dopo')}</div>
    <label>Nota (facoltativa)<input name="nota" maxlength="300" value="${esc(f.nota || '')}" placeholder="es. ritirato anche un materasso"></label>
    <button class="btn" value="fatto">✅ Fatto: invia al responsabile</button>`}
    <button class="btn ghost" value="close" formnovalidate>Chiudi</button>`, (a, fd) => {
    if (fd.get('nota') !== null) f.nota = String(fd.get('nota') || '');
    if (a === 'shot') { setTimeout(() => intShowShot(x), 50); return; }
    if (a === 'fatto') {
      if (!f.dopo) { alert('Fai almeno la foto dopo il ritiro.'); return false; }
      setTimeout(() => intClose(x), 50);
    }
  });
  document.querySelectorAll('[data-foto]').forEach(inp => {
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try { f[inp.dataset.foto] = await compressImage(file); } catch (e) { alert('Non riesco a leggere la foto, riprova.'); }
      const nota = $('#dlgBody input[name=nota]');
      if (nota) f.nota = nota.value;
      intView(id);
    };
  });
}
async function intShowShot(x) {
  openDialog('<h3>🖼️ Segnalazione</h3><p>Carico l\'immagine…</p><button class="btn ghost" value="back">Indietro</button>', () => setTimeout(() => intView(x.id), 50));
  try {
    const res = await withTimeout(fetch(ep(`azione=fotointervento&tipo=screenshot&id=${encodeURIComponent(x.id)}`)), 30000);
    const out = await res.json();
    if (!dlg.open) return;
    openDialog(`<h3>🖼️ Segnalazione</h3>${out.foto ? `<img class="int-shot" src="${out.foto}" alt="Segnalazione">` : '<p>Immagine non disponibile.</p>'}
      <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(() => intView(x.id), 50));
  } catch (e) {
    openDialog('<h3>🖼️ Segnalazione</h3><p>Serve la connessione per vedere l\'immagine.</p><button class="btn ghost" value="back">Indietro</button>', () => setTimeout(() => intView(x.id), 50));
  }
}
async function intClose(x) {
  const f = intFoto[x.id] || {};
  busy('Chiudo l\'intervento');
  const pos = await getPos();
  const at = Date.now();
  enqueue({ type: 'intervento', intervento: { id: x.id, fotoPrima: f.prima || null, fotoDopo: f.dopo || null, nota: f.nota || '', at, pos: pos.errore ? null : pos } });
  db.intChiusi = Object.assign({}, db.intChiusi, { [x.id]: at });
  save();
  const c = cfg();
  const text = [`✅ Intervento fatto`, intWhere(x), x.cliente ? `Cliente: ${x.cliente}` : '', x.cosa ? `Ritirato: ${x.cosa}` : '',
    `Ora: ${fmtTime(at)} del ${new Date(at).toLocaleDateString('it-IT')}`, `Operatore: ${fullName()}`, f.nota ? `Nota: ${f.nota}` : ''].filter(Boolean).join('\n');
  const files = [f.prima && dataUrlToFile(f.prima, 'prima.jpg'), f.dopo && dataUrlToFile(f.dopo, 'dopo.jpg')].filter(Boolean);
  openDialog(`<h3>✅ Intervento chiuso</h3>
    <p>Foto e dati partono verso il registro appena c'è rete. Ora mandali al responsabile su WhatsApp.</p>
    <button class="btn" value="share">📤 Invia foto su WhatsApp</button>
    <a class="btn ghost" href="https://wa.me/${esc(c.autorizzaTelefono || '')}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 Solo il messaggio</a>
    <button class="btn ghost" value="">Chiudi</button>`, async a => {
    if (a !== 'share') return;
    if (navigator.canShare && files.length && navigator.canShare({ files })) {
      try { await navigator.share({ files, text, title: 'Intervento fatto' }); } catch (e) { /* annullato */ }
    } else {
      window.open(`https://wa.me/${c.autorizzaTelefono || ''}?text=${encodeURIComponent(text)}`, '_blank');
    }
  });
  delete intFoto[x.id];
}

// Responsabile: elenco, nuovo intervento, dettaglio con foto
let admInt = [], admIntPeople = [];
function adminInterventi() {
  call('interventi', null, 'Carico gli interventi', out => {
    if (!Array.isArray(out.interventi)) return fail('Per usare gli interventi va aggiornato lo script Google (guida nel repository).');
    admInt = out.interventi; admIntPeople = (out.operatori || []).filter(o => o.attivo !== false);
    adminIntList();
  });
}
function adminIntList() {
  const daFare = admInt.filter(x => x.stato !== 'Fatto'), fatti = admInt.filter(x => x.stato === 'Fatto').slice(0, 30);
  const row = x => `<button type="button" class="shift-row" data-aint="${esc(x.id)}">
    <b>${x.stato === 'Fatto' ? '✅' : '📍'} ${esc(intWhere(x))}</b><br>
    <span>${x.data ? esc(dayLabel(x.data)) + ' · ' : ''}${esc(x.assegnato)}${x.cosa ? ' · ' + esc(x.cosa) : ''}${x.stato === 'Fatto' ? ` · fatto da ${esc(x.fattoDa)} alle ${fmtTime(x.fattoIl)}` : ''}</span></button>`;
  openDialog(`
    <h3>📍 Interventi</h3>
    <button class="btn" value="new">➕ Nuovo intervento</button>
    <div class="adm-list">
      ${daFare.length ? `<p><b>Da fare (${daFare.length})</b></p>${daFare.map(row).join('')}` : '<p class="note">Nessun intervento da fare.</p>'}
      ${fatti.length ? `<p><b>Fatti</b></p>${fatti.map(row).join('')}` : ''}
    </div>
    <button class="btn ghost" value="back">Indietro</button>`, a => {
    if (a === 'new') { admShot = null; setTimeout(() => adminIntEdit(null), 50); }
    if (a === 'back') setTimeout(adminHome, 50);
  });
  document.querySelectorAll('[data-aint]').forEach(b => {
    b.onclick = () => { const x = admInt.find(i => i.id === b.dataset.aint); if (x) { admShot = null; (x.stato === 'Fatto' ? adminIntDone(x) : adminIntEdit(x)); } };
  });
}
let admShot = null;
function adminIntEdit(x, keep) {
  const v = Object.assign({}, x || { data: isoDay(new Date()), assegnato: INT_TUTTI }, keep || {});
  openDialog(`
    <h3>${x ? 'Modifica intervento' : '➕ Nuovo intervento'}</h3>
    <label>Giorno<input type="date" name="data" value="${esc(v.data || isoDay(new Date()))}"></label>
    <label>Cliente<input name="cliente" maxlength="80" value="${esc(v.cliente || '')}" placeholder="nome e cognome"></label>
    <label>Via e numero<input name="indirizzo" required maxlength="120" value="${esc(v.indirizzo || '')}" placeholder="es. Via Roma 12"></label>
    <label>Località<input name="localita" maxlength="60" value="${esc(v.localita || '')}" placeholder="es. Pontedera"></label>
    <label>Coordinate (facoltative)<input name="coord" maxlength="60" value="${esc(v.coord || '')}" placeholder="es. 43.6629, 10.6328" inputmode="decimal"></label>
    <label>Cosa ritirare<textarea name="cosa" maxlength="500" rows="2" placeholder="es. divano 3 posti, 2 sedie">${esc(v.cosa || '')}</textarea></label>
    <label>Note<input name="note" maxlength="300" value="${esc(v.note || '')}" placeholder="es. citofono Rossi, materiale in giardino"></label>
    <label>Assegna a<select name="assegnato"><option>${INT_TUTTI}</option>${admIntPeople.map(p => `<option ${p.nome === v.assegnato ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
    <label class="int-photo wide">${admShot ? `<img src="${admShot}" alt="Screenshot">` : `<span>🖼️ ${x && x.screenshot ? 'Cambia lo screenshot della segnalazione' : 'Allega lo screenshot della segnalazione'}</span>`}
      <input type="file" accept="image/*" id="admShotIn" hidden></label>
    <div class="row">
      ${x ? '<button class="btn ghost danger-text" value="del" formnovalidate>Elimina</button>' : ''}
      <button class="btn ghost" value="back" formnovalidate>Annulla</button>
      <button class="btn" value="save">Salva</button>
    </div>`, (a, fd) => {
    if (a === 'back') { admShot = null; return setTimeout(adminIntList, 50); }
    if (a === 'del') {
      if (!confirm('Eliminare questo intervento?')) return false;
      return setTimeout(() => call('eliminaintervento', { id: x.id }, 'Elimino', out => { admInt = out.interventi; adminIntList(); }), 50);
    }
    const it = { id: x ? x.id : uid() };
    ['data', 'cliente', 'indirizzo', 'localita', 'coord', 'cosa', 'note', 'assegnato'].forEach(k => { it[k] = String(fd.get(k) || '').trim(); });
    if (admShot) it.screenshot = admShot;
    setTimeout(() => call('salvaintervento', { intervento: it }, 'Salvo l\'intervento', out => {
      admInt = out.interventi; admShot = null; toast('Intervento salvato ✓'); adminIntList();
    }), 50);
  });
  $('#admShotIn').onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Conserva quanto già scritto prima di ridisegnare
    const fd = new FormData($('#dlgBody'));
    const keep = Object.assign({}, Object.fromEntries(['data', 'cliente', 'indirizzo', 'localita', 'coord', 'cosa', 'note', 'assegnato'].map(k => [k, String(fd.get(k) || '')])));
    try { admShot = await compressImage(file, 1600, 0.75); } catch (err) { alert('Non riesco a leggere l\'immagine.'); }
    adminIntEdit(x, keep);
  };
}
function adminIntDone(x) {
  openDialog(`
    <h3>✅ Intervento fatto</h3>
    <div class="int-info">
      <b>${esc(intWhere(x))}</b>
      ${x.cliente ? `<span>👤 ${esc(x.cliente)}</span>` : ''}
      ${x.cosa ? `<span>📦 ${esc(x.cosa)}</span>` : ''}
      <span>👷 ${esc(x.fattoDa)} · ${new Date(x.fattoIl).toLocaleDateString('it-IT')} alle ${fmtTime(x.fattoIl)}</span>
      ${x.notaOp ? `<span>📝 ${esc(x.notaOp)}</span>` : ''}
    </div>
    <div class="int-photos" id="admPhotos"><div class="int-photo"><span>Carico le foto…</span></div></div>
    ${x.posChiusura && /^https:/.test(x.posChiusura) ? `<a class="btn ghost" href="${esc(x.posChiusura.split(' ')[0])}" target="_blank" rel="noopener">📍 Dove è stato chiuso</a>` : ''}
    <div class="row"><button class="btn ghost" value="reopen" formnovalidate>Riapri</button><button class="btn" value="back">Indietro</button></div>`, a => {
    if (a === 'reopen') return setTimeout(() => call('riapriintervento', { id: x.id }, 'Riapro', out => { admInt = out.interventi; adminIntList(); }), 50);
    setTimeout(adminIntList, 50);
  });
  Promise.all(['prima', 'dopo'].map(t => (x[t === 'prima' ? 'fotoPrima' : 'fotoDopo'] ? adminCall('fotointervento', { id: x.id, tipo: t }).then(o => o.foto).catch(() => null) : Promise.resolve(null))))
    .then(([prima, dopo]) => {
      const box = $('#admPhotos');
      if (!box) return;
      const one = (src, l) => `<div class="int-photo">${src ? `<img src="${src}" alt="${l}">` : `<span>${l}: nessuna</span>`}<small>${l}</small></div>`;
      box.innerHTML = one(prima, 'Prima') + one(dopo, 'Dopo');
    });
}

// ---------- DPI e vestiario (solo area responsabile) ----------
// Consegne per operatore con scadenza calcolata dalla durata del capo, taglie, scadenze e cosa ordinare.
let dpiData = null;
const DPI_TAGLIA_LABEL = { maglia: 'Maglia', pantalone: 'Pantalone', scarpe: 'Scarpe' };
const dpiMesiTxt = m => !m ? 'senza scadenza' : m % 12 === 0 ? `ogni ${m / 12 === 1 ? 'anno' : m / 12 + ' anni'}` : `ogni ${m} mes${m === 1 ? 'e' : 'i'}`;
const dpiDays = iso => iso ? Math.round((dayFromIso(iso) - dayFromIso(isoDay(new Date()))) / 864e5) : null;
const dpiStato = c => { const g = dpiDays(c.scadenza); return g === null ? 'na' : g < 0 ? 'over' : g <= 30 ? 'under' : 'ok'; };
const dmyIt = iso => dayFromIso(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dpiTaglieDi = nome => (dpiData && dpiData.taglie[String(nome).trim().toLowerCase()]) || { maglia: '', pantalone: '', scarpe: '', note: '' };
// Ultima consegna per ogni capo di un operatore (le precedenti sono già state sostituite)
function dpiAttuali(nome) {
  const m = {};
  dpiData.consegne.filter(c => sameName(c.operatore, nome)).forEach(c => { if (!m[c.capo] || m[c.capo].data < c.data) m[c.capo] = c; });
  return m;
}
function dpiLoad(then) {
  call('dpi', null, 'Carico DPI e vestiario', out => {
    if (!Array.isArray(out.capi)) return fail('Per usare DPI e vestiario va aggiornato lo script Google (guida nel repository).');
    dpiData = out; then();
  });
}
function adminDpi() { dpiLoad(dpiHome); }
function dpiPeople() { return (dpiData.operatori || []).filter(o => o.attivo !== false).map(o => o.nome); }
function dpiScadenze() {
  const out = [];
  dpiPeople().forEach(n => Object.values(dpiAttuali(n)).forEach(c => { const st = dpiStato(c); if (st === 'over' || st === 'under') out.push(c); }));
  return out.sort((a, b) => a.scadenza.localeCompare(b.scadenza));
}
function dpiHome() {
  const sc = dpiScadenze(), over = sc.filter(c => dpiStato(c) === 'over').length;
  openDialog(`
    <h3>🦺 DPI e vestiario</h3>
    <button class="btn" value="new">➕ Nuova consegna</button>
    <div class="menu">
      <button class="btn ghost" value="op">👤 Dotazioni per operatore</button>
      <button class="btn ghost" value="scad">⏰ Scadenze${sc.length ? ` <span class="badge">${sc.length}</span>` : ''}${over ? ` <small class="dpi-red">${over} scadut${over === 1 ? 'o' : 'i'}</small>` : ''}</button>
      <button class="btn ghost" value="ord">📦 Da ordinare</button>
      <button class="btn ghost" value="capi">⚙️ Capi e durata</button>
      <button class="btn ghost" value="back">Indietro</button>
    </div>`, a => {
    const go = { new: () => dpiNew(), op: () => dpiPickOp(), scad: dpiScadView, ord: dpiOrder, capi: dpiCapiEdit, back: adminHome }[a];
    if (go) setTimeout(go, 50);
  });
}
function dpiNew(nome) {
  const people = dpiPeople();
  const capi = dpiData.capi.filter(c => c.attivo);
  const sel = nome || people[0] || '';
  const t = dpiTaglieDi(sel);
  openDialog(`
    <h3>➕ Nuova consegna</h3>
    <label>Operatore<select name="op" id="dpiOp">${people.map(p => `<option ${p === sel ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label>Data<input type="date" name="data" value="${isoDay(new Date())}"></label>
    <p class="note">Spunta i capi consegnati. La taglia è quella salvata per l'operatore: se la cambi viene aggiornata.</p>
    <div class="plan-people">${capi.map((c, i) => `<div class="pp dpi-row">
      <label class="dpi-chk"><input type="checkbox" name="c${i}"><span>${esc(c.nome)}<em>${dpiMesiTxt(c.mesi)}</em></span></label>
      ${c.taglia ? `<input name="t${i}" class="dpi-tg" value="${esc(t[c.taglia] || '')}" placeholder="${DPI_TAGLIA_LABEL[c.taglia]}" data-tipo="${c.taglia}" aria-label="Taglia ${esc(c.nome)}">` : ''}
      <input name="q${i}" class="dpi-q" inputmode="numeric" value="1" aria-label="Quantità ${esc(c.nome)}">
    </div>`).join('')}</div>
    <label>Note (facoltative)<input name="note" maxlength="200" placeholder="es. sostituzione per usura"></label>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Annulla</button><button class="btn" value="ok">Registra</button></div>`, (a, fd) => {
    if (a === 'back') return setTimeout(dpiHome, 50);
    const op = String(fd.get('op') || '');
    const righe = [], taglie = Object.assign({}, dpiTaglieDi(op));
    capi.forEach((c, i) => {
      const tg = String(fd.get('t' + i) || '').trim();
      if (c.taglia && tg) taglie[c.taglia] = tg;
      if (fd.get('c' + i)) righe.push({ capo: c.nome, taglia: tg, qta: Number(fd.get('q' + i)) || 1 });
    });
    if (!op || !righe.length) { alert('Scegli l\'operatore e almeno un capo.'); return false; }
    setTimeout(() => call('dpiconsegna', { consegna: { id: uid(), data: String(fd.get('data') || isoDay(new Date())), operatore: op, righe, note: String(fd.get('note') || '').trim(), taglie } },
      'Registro la consegna', out => { dpiData = out; toast(`Consegna registrata ✓ (${righe.length} cap${righe.length === 1 ? 'o' : 'i'})`); dpiOp(op); }), 50);
  });
  // Cambiando operatore si ricaricano le sue taglie
  $('#dpiOp').onchange = e => {
    const tt = dpiTaglieDi(e.target.value);
    document.querySelectorAll('#dlgBody .dpi-tg').forEach(inp => { inp.value = tt[inp.dataset.tipo] || ''; });
  };
}
function dpiPickOp() {
  openDialog(`
    <h3>👤 Dotazioni per operatore</h3>
    <div class="adm-list">${dpiPeople().map(p => {
      const att = Object.values(dpiAttuali(p));
      const o = att.filter(c => dpiStato(c) === 'over').length, u = att.filter(c => dpiStato(c) === 'under').length;
      return `<button type="button" class="shift-row dpi-oprow" data-dop="${esc(p)}"><span class="dpi-txt"><b>${esc(p)}</b>
        <span>${att.length ? `${att.length} capi consegnati` : 'Nessuna consegna'}${o ? ` · <b class="dpi-red">${o} scadut${o === 1 ? 'o' : 'i'}</b>` : ''}${u ? ` · ${u} in scadenza` : ''}</span></span><span class="dpi-gear" aria-hidden="true">⚙️</span></button>`;
    }).join('') || '<p class="note">Nessun operatore.</p>'}</div>
    <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(dpiHome, 50));
  document.querySelectorAll('[data-dop]').forEach(b => { b.onclick = () => dpiOp(b.dataset.dop); });
}
function dpiOp(nome) {
  const t = dpiTaglieDi(nome);
  const att = dpiAttuali(nome);
  const capi = dpiData.capi.filter(c => c.attivo || att[c.nome]);
  const stTxt = c => { const g = dpiDays(c.scadenza); return g === null ? 'senza scadenza' : g < 0 ? `scaduto da ${-g} g` : g === 0 ? 'scade oggi' : `scade tra ${g} g`; };
  openDialog(`
    <h3>👤 ${esc(nome)}</h3>
    <div class="dpi-taglie">
      <label>Maglia<input name="maglia" value="${esc(t.maglia)}" placeholder="es. L"></label>
      <label>Pantalone<input name="pantalone" value="${esc(t.pantalone)}" placeholder="es. 48"></label>
      <label>Scarpe<input name="scarpe" value="${esc(t.scarpe)}" placeholder="es. 43"></label>
    </div>
    <div class="dpi-list">${capi.map(c => {
      const x = att[c.nome];
      return `<div class="dpi-it ${x ? 'd-' + dpiStato(x) : 'd-none'}" ${x ? `data-dedit="${esc(x.id)}"` : ''}><div class="dpi-txt"><b>${esc(c.nome)}${x && x.taglia ? ` <small>${esc(x.taglia)}</small>` : ''}</b>
        <span>${x ? `consegnato il ${dmyIt(x.data)}${x.qta > 1 ? ` (×${x.qta})` : ''} · ${stTxt(x)}` : 'mai consegnato'}</span></div>${x ? '<span class="dpi-gear" aria-label="Modifica">⚙️</span>' : ''}</div>`;
    }).join('')}</div>
    <div class="menu">
      <button class="btn" value="new">➕ Nuova consegna a ${esc(nome)}</button>
      <div class="row"><button class="btn ghost" value="tg">💾 Salva taglie</button><button class="btn ghost" value="pdf">📄 Scheda PDF</button></div>
      <button class="btn ghost" value="storico">📜 Tutte le consegne (modifica o elimina)</button>
      <button class="btn ghost" value="back">Indietro</button>
    </div>`, (a, fd) => {
    if (a === 'new') return setTimeout(() => dpiNew(nome), 50);
    if (a === 'pdf') return setTimeout(() => dpiPrint(nome), 50);
    if (a === 'storico') return setTimeout(() => dpiStorico(nome), 50);
    if (a === 'tg') return setTimeout(() => call('dpitaglie', { operatore: nome, taglie: { maglia: String(fd.get('maglia') || ''), pantalone: String(fd.get('pantalone') || ''), scarpe: String(fd.get('scarpe') || ''), note: t.note } },
      'Salvo le taglie', out => { dpiData = out; toast('Taglie salvate ✓'); dpiOp(nome); }), 50);
    setTimeout(dpiPickOp, 50);
  });
  dpiBindEdit(nome);
}
// Tocca un capo consegnato per correggerlo. La modifica sostituisce la riga (elimina + nuova consegna),
// così la scadenza si ricalcola dalla nuova data.
function dpiBindEdit(nome) {
  document.querySelectorAll('#dlgBody [data-dedit]').forEach(el => {
    el.style.cursor = 'pointer';
    el.onclick = () => { const c = dpiData.consegne.find(x => x.id === el.dataset.dedit); if (c) dpiEdit(c, () => dpiOp(nome)); };
  });
}
function dpiStorico(nome) {
  const cons = dpiData.consegne.filter(c => sameName(c.operatore, nome));
  openDialog(`
    <h3>📜 Consegne a ${esc(nome)}</h3>
    <p class="note">Tocca una consegna per modificarla o eliminarla.</p>
    <div class="dpi-list">${cons.map(c => `<div class="dpi-it d-${dpiStato(c)}" data-dedit="${esc(c.id)}"><div class="dpi-txt"><b>${esc(c.capo)}${c.taglia ? ` <small>${esc(c.taglia)}</small>` : ''}</b>
      <span>${dmyIt(c.data)}${c.qta > 1 ? ` · ×${c.qta}` : ''}${c.scadenza ? ` · scade ${dmyIt(c.scadenza)}` : ''}${c.note ? ` · ${esc(c.note)}` : ''}</span></div><span class="dpi-gear" aria-label="Modifica">⚙️</span></div>`).join('') || '<p class="note">Nessuna consegna.</p>'}</div>
    <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(() => dpiOp(nome), 50));
  document.querySelectorAll('#dlgBody [data-dedit]').forEach(el => {
    el.style.cursor = 'pointer';
    el.onclick = () => { const c = dpiData.consegne.find(x => x.id === el.dataset.dedit); if (c) dpiEdit(c, () => dpiStorico(nome)); };
  });
}
function dpiEdit(c, back) {
  const capi = dpiData.capi.filter(x => x.attivo || x.nome === c.capo);
  openDialog(`
    <h3>✎ Modifica consegna</h3>
    <p class="note">${esc(c.operatore)}</p>
    <label>Capo<select name="capo">${capi.map(x => `<option ${x.nome === c.capo ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
    <label>Data di consegna<input type="date" name="data" required value="${esc(c.data)}"></label>
    <div class="row"><label>Taglia<input name="taglia" maxlength="10" value="${esc(c.taglia || '')}"></label>
      <label>Quantità<input name="qta" inputmode="numeric" value="${c.qta || 1}"></label></div>
    <label>Note<input name="note" maxlength="200" value="${esc(c.note || '')}"></label>
    <p class="note">La scadenza si ricalcola dalla data e dalla durata del capo.</p>
    <div class="row">
      <button class="btn ghost danger-text" value="del" formnovalidate>Elimina</button>
      <button class="btn ghost" value="back" formnovalidate>Annulla</button>
      <button class="btn" value="ok">Salva</button>
    </div>`, (a, fd) => {
    if (a === 'back') return setTimeout(back, 50);
    if (a === 'del') {
      if (!confirm(`Eliminare la consegna di ${c.capo} del ${dmyIt(c.data)}?`)) return false;
      return setTimeout(() => call('dpielimina', { id: c.id }, 'Elimino', out => { dpiData = out; toast('Consegna eliminata'); back(); }), 50);
    }
    const nuova = { id: uid(), data: String(fd.get('data') || c.data), operatore: c.operatore, note: String(fd.get('note') || '').trim(),
      righe: [{ capo: String(fd.get('capo') || c.capo), taglia: String(fd.get('taglia') || '').trim(), qta: Number(fd.get('qta')) || 1 }] };
    setTimeout(() => call('dpielimina', { id: c.id }, 'Salvo la modifica', () =>
      call('dpiconsegna', { consegna: nuova }, 'Salvo la modifica', out => { dpiData = out; toast('Consegna modificata ✓'); back(); })), 50);
  });
}
function dpiScadView() {
  const sc = dpiScadenze();
  openDialog(`
    <h3>⏰ Scadenze</h3>
    <p class="note">Capi scaduti e in scadenza nei prossimi 30 giorni (conta l'ultima consegna di ogni capo).</p>
    <div class="dpi-list">${sc.map(c => { const g = dpiDays(c.scadenza); return `<div class="dpi-it d-${dpiStato(c)}" data-dop="${esc(c.operatore)}">
      <b>${esc(c.operatore)} · ${esc(c.capo)}${c.taglia ? ` <small>${esc(c.taglia)}</small>` : ''}</b>
      <span>${g < 0 ? `scaduto da ${-g} giorni` : g === 0 ? 'scade oggi' : `scade tra ${g} giorni`} · ${dmyIt(c.scadenza)}</span></div>`; }).join('') || '<p>Nessun capo in scadenza. ✓</p>'}</div>
    <div class="row"><button class="btn ghost" value="ord">📦 Da ordinare</button><button class="btn" value="back">Indietro</button></div>`,
    a => setTimeout(a === 'ord' ? dpiOrder : dpiHome, 50));
  document.querySelectorAll('#dlgBody [data-dop]').forEach(b => { b.style.cursor = 'pointer'; b.onclick = () => dpiOp(b.dataset.dop); });
}
// Da ordinare: capi scaduti o in scadenza, raggruppati per capo e taglia
function dpiOrderRows() {
  const m = {};
  dpiScadenze().forEach(c => {
    const tg = c.taglia || ((dpiData.capi.find(x => x.nome === c.capo) || {}).taglia ? dpiTaglieDi(c.operatore)[(dpiData.capi.find(x => x.nome === c.capo) || {}).taglia] : '') || '—';
    const k = c.capo + '|' + tg;
    (m[k] = m[k] || { capo: c.capo, taglia: tg, qta: 0, chi: [] });
    m[k].qta += c.qta || 1; m[k].chi.push(c.operatore);
  });
  return Object.values(m).sort((a, b) => a.capo.localeCompare(b.capo) || String(a.taglia).localeCompare(String(b.taglia), 'it', { numeric: true }));
}
function dpiOrderDoc() {
  const rows = dpiOrderRows();
  return `<div class="plan-doc"><div class="pd-head"><img src="logo.png" alt="GE3CO"><div><h1>DPI e vestiario da ordinare</h1><p>Aggiornato al ${dmyIt(isoDay(new Date()))}</p></div></div>
    <table class="pd-t dpi-t"><thead><tr><th style="text-align:left">Capo</th><th>Taglia</th><th>Quantità</th><th style="text-align:left">Per</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.capo)}</td><td style="text-align:center">${esc(r.taglia)}</td><td style="text-align:center"><b>${r.qta}</b></td><td>${r.chi.map(esc).join(', ')}</td></tr>`).join('') || '<tr><td colspan="4">Niente da ordinare.</td></tr>'}</tbody></table></div>`;
}
function dpiOrder() {
  const rows = dpiOrderRows();
  openDialog(`
    <h3>📦 Da ordinare</h3>
    <p class="note">Capi scaduti o in scadenza nei prossimi 30 giorni, per taglia.</p>
    <div class="rep-wrap"><table class="rep"><thead><tr><th>Capo</th><th>Taglia</th><th>Q.tà</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.capo)}</td><td>${esc(r.taglia)}</td><td>${r.qta}</td></tr>`).join('') || '<tr><td colspan="3">Niente da ordinare ✓</td></tr>'}</tbody></table></div>
    <div class="menu">
      <button class="btn" value="pdf" ${rows.length ? '' : 'disabled'}>📄 PDF / stampa per il fornitore</button>
      <button class="btn ghost" value="back">Indietro</button>
    </div>`, a => {
    if (a === 'pdf') return setTimeout(() => dpiPrintHtml(dpiOrderDoc(), dpiOrder), 50);
    setTimeout(dpiHome, 50);
  });
}
function dpiDoc(nome) {
  const t = dpiTaglieDi(nome);
  const cons = dpiData.consegne.filter(c => sameName(c.operatore, nome)).sort((a, b) => a.data.localeCompare(b.data) || a.capo.localeCompare(b.capo));
  return `<div class="plan-doc"><div class="pd-head"><img src="logo.png" alt="GE3CO"><div><h1>Scheda consegna DPI e vestiario</h1>
      <p>Operatore: <b>${esc(nome)}</b> · Taglie: maglia ${esc(t.maglia || '—')}, pantalone ${esc(t.pantalone || '—')}, scarpe ${esc(t.scarpe || '—')}</p></div></div>
    <table class="pd-t dpi-t"><thead><tr><th style="text-align:left">Data</th><th style="text-align:left">Capo / DPI</th><th>Taglia</th><th>Q.tà</th><th>Scadenza</th><th style="width:22%">Firma operatore</th></tr></thead>
    <tbody>${cons.map(c => `<tr><td>${dmyIt(c.data)}</td><td>${esc(c.capo)}</td><td style="text-align:center">${esc(c.taglia || '')}</td><td style="text-align:center">${c.qta}</td><td style="text-align:center">${c.scadenza ? dmyIt(c.scadenza) : ''}</td><td style="height:26px"></td></tr>`).join('') || '<tr><td colspan="6">Nessuna consegna registrata.</td></tr>'}</tbody></table>
    <p class="pd-note">Il lavoratore dichiara di aver ricevuto i dispositivi sopra indicati e si impegna a utilizzarli correttamente e a conservarli con cura (D.Lgs. 81/2008, art. 20 e 78).</p>
    <p class="pd-note" style="margin-top:22px">Data ________________ &nbsp;&nbsp; Firma del lavoratore ______________________________ &nbsp;&nbsp; Firma del responsabile ______________________________</p></div>`;
}
function dpiPrintHtml(html, back) {
  $('#printArea').innerHTML = html;
  document.body.classList.add('print-modulo');
  const imgs = [...document.querySelectorAll('#printArea img')];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; setTimeout(ok, 3000); }))).then(() => {
    window.print();
    setTimeout(() => { document.body.classList.remove('print-modulo'); back(); }, 300);
  });
}
function dpiPrint(nome) { dpiPrintHtml(dpiDoc(nome), () => dpiOp(nome)); }
function dpiCapiEdit() {
  const capi = dpiData.capi;
  openDialog(`
    <h3>⚙️ Capi e durata</h3>
    <p class="note">Ogni quanti mesi si sostituisce un capo. I valori iniziali sono indicativi: mettete quelli previsti da voi (0 = nessuna scadenza).</p>
    <div class="plan-people">${capi.map((c, i) => `<div class="pp dpi-row">
      <label class="dpi-chk"><input type="checkbox" name="a${i}" ${c.attivo ? 'checked' : ''}><span>${esc(c.nome)}</span></label>
      <label class="ore-in"><input name="m${i}" inputmode="numeric" value="${c.mesi}" aria-label="Mesi ${esc(c.nome)}"> mesi</label></div>`).join('')}</div>
    <label>Aggiungi un capo<input name="nuovo" maxlength="60" placeholder="es. Tappi antirumore"></label>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Annulla</button><button class="btn" value="ok">Salva</button></div>`, (a, fd) => {
    if (a === 'back') return setTimeout(dpiHome, 50);
    const lista = capi.map((c, i) => ({ nome: c.nome, taglia: c.taglia, mesi: Number(fd.get('m' + i)) || 0, attivo: !!fd.get('a' + i) }));
    const nuovo = String(fd.get('nuovo') || '').trim();
    if (nuovo && !lista.some(c => sameName(c.nome, nuovo))) lista.push({ nome: nuovo.charAt(0).toUpperCase() + nuovo.slice(1), taglia: '', mesi: 12, attivo: true });
    setTimeout(() => call('dpicapi', { capi: lista }, 'Salvo i capi', out => { dpiData = out; toast('Capi salvati ✓'); dpiHome(); }), 50);
  });
}

// ---------- Programma della settimana ----------
// Il responsabile assegna le squadre (cantiere + operatori) per giorno e turno; gli operatori vedono i propri turni.
// Chi è in due turni lo stesso giorno fa il doppio turno (in rosso nel programma).
const PLAN_TURNI = [{ nome: 'Mattina', orario: '06–11' }, { nome: 'Pomeriggio', orario: '13–18' }];
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayFromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dayFromIso(s); d.setDate(d.getDate() + n); return isoDay(d); };
const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return isoDay(x); };
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const dayLabel = s => dayFromIso(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });
const turnoInfo = n => PLAN_TURNI.find(t => t.nome === n) || { nome: n, orario: '' };
// Ore settimanali da contratto: dal foglio Operatori se lo script le gestisce, altrimenti salvate su questo telefono
const ORE_DEFAULT = 30;
const FERIE = 'Ferie';
// Assenze nel programma: ognuna conta come un turno (oreTurno ore)
const ASSENZE = [{ nome: 'Ferie', icona: '🌴', colore: '#0ea5e9' }, { nome: 'Malattia', icona: '🤒', colore: '#a855f7' }, { nome: 'Permesso', icona: '📝', colore: '#f59e0b' }];
const isAss = t => ASSENZE.some(a => a.nome === t);
const assInfo = t => ASSENZE.find(a => a.nome === t) || ASSENZE[0];
// Riepilogo delle assenze di un giorno: "🌴 Ferie: A, B · 🤒 Malattia: C"
const assDay = (squadre, d, sep) => ASSENZE.map(a => { const f = squadre.find(x => x.data === d && x.turno === a.nome); return f ? `${a.icona} ${a.nome}: ${f.operatori.map(esc).join(', ')}` : ''; }).filter(Boolean).join(sep || ' · ');
function oreContratto(nome) {
  const p = (typeof planPeople !== 'undefined' ? planPeople : []).find(x => sameName(x.nome, nome));
  if (p && Number(p.ore) > 0) return Number(p.ore);
  const loc = (db.oreOp || {})[String(nome).trim().toLowerCase()];
  return Number(loc) > 0 ? Number(loc) : ORE_DEFAULT;
}
// Ore in programma nella settimana: ogni turno (e ogni giorno di ferie) vale oreTurno ore
function oreSettimana(squadre) {
  const m = {};
  squadre.forEach(s => s.operatori.forEach(o => {
    const k = o.trim().toLowerCase();
    const x = m[k] || (m[k] = { nome: o, lavoro: 0, ferie: 0 });
    if (isAss(s.turno)) x.ferie += cfg().oreTurno; else x.lavoro += cfg().oreTurno;
  }));
  return m;
}
function doppi(squadre) {
  // "data|nome" → numero di turni diversi (le ferie non contano)
  const m = {};
  squadre.filter(s => !isAss(s.turno)).forEach(s => s.operatori.forEach(o => {
    const k = s.data + '|' + o.toLowerCase();
    (m[k] = m[k] || new Set()).add(s.turno);
  }));
  return (data, nome) => (m[data + '|' + String(nome).toLowerCase()] || new Set()).size > 1;
}

// Operatore: scarica il programma dei prossimi giorni
async function syncPlan() {
  if (!db.endpoint || navigator.onLine === false) return;
  try {
    const res = await withTimeout(fetch(ep('azione=programma')), 20000);
    const out = await res.json();
    if (!out.ok || !Array.isArray(out.squadre)) return;
    const next = { squadre: out.squadre, at: Date.now() };
    if (JSON.stringify(next.squadre) !== JSON.stringify((db.plan || {}).squadre)) { db.plan = next; save(); render(); }
  } catch (e) { /* offline o script da aggiornare: resta il programma già scaricato */ }
}
// Nel programma un operatore può essere scritto con nome e cognome o solo col cognome (come nel foglio di Ciulli)
const isMe = o => !!db.user && [fullName(), db.user.last, `${db.user.last} ${db.user.first}`].some(n => sameName(o, n));
function myPlan() {
  if (!db.plan || !db.user) return [];
  const oggi = isoDay(new Date());
  return db.plan.squadre.filter(s => s.data >= oggi && s.operatori.some(isMe));
}
function renderPlan() {
  const box = $('#plan');
  if (!box) return;
  const mine = myPlan();
  if (!db.plan || !db.user) { box.hidden = true; return; }
  box.hidden = false;
  const me = fullName();
  const isD = doppi(db.plan.squadre);
  const oggi = isoDay(new Date()), domani = addDays(oggi, 1);
  const when = d => d === oggi ? 'Oggi' : d === domani ? 'Domani' : dayLabel(d);
  const rows = mine.slice(0, 4).map(s => {
    const t = turnoInfo(s.turno);
    if (isAss(s.turno)) { const ai = assInfo(s.turno); return `<li><span class="dot" style="background:${ai.colore}"></span>
      <div class="grow"><b>${esc(when(s.data))} · ${ai.icona} ${esc(ai.nome)}</b><span>${s.nota ? esc(s.nota) : 'Giorno di ' + esc(ai.nome.toLowerCase())}</span></div></li>`; }
    const altri = s.operatori.filter(o => !isMe(o));
    const site = db.sites.find(x => x.name === s.cantiere);
    return `<li>
      <span class="dot" style="background:${esc(site ? site.color : 'var(--brand)')}"></span>
      <div class="grow"><b>${esc(when(s.data))} · ${esc(t.nome)} ${esc(t.orario)}</b>
        <span>${esc(s.cantiere)}${altri.length ? ' · con ' + esc(altri.join(', ')) : ''}${s.nota ? ' · ' + esc(s.nota) : ''}</span></div>
      ${isD(s.data, s.operatori.find(isMe) || me) ? '<span class="pill doppio">Doppio</span>' : ''}
    </li>`;
  });
  box.innerHTML = `<div class="sec-head"><div><small>IL TUO PROGRAMMA</small><h2>Prossimi turni</h2></div></div>
    <ul class="list">${rows.length ? rows.join('') : '<li class="empty">Nessun turno in programma per te nei prossimi giorni.</li>'}</ul>`;
}

// Responsabile: programma della settimana
let planWeek = null, planSquads = [], planPeople = [], planSites = [], planDirty = false;
function adminPlan(week) {
  planWeek = week || planWeek || mondayOf(new Date());
  call('programma', { da: planWeek, a: addDays(planWeek, 6) }, 'Carico il programma', out => {
    if (!Array.isArray(out.squadre)) return fail('Per usare il programma va aggiornato lo script Google (guida nel repository).');
    planSquads = out.squadre; planPeople = out.operatori || []; planSites = (out.cantieri || []).filter(c => c.attivo !== false);
    planDirty = false;
    planView();
  });
}
function planView() {
  const isD = doppi(planSquads);
  const fine = addDays(planWeek, 6);
  const titolo = `${dayFromIso(planWeek).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} – ${dayFromIso(fine).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`;
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(planWeek, i));
  const color = n => ((planSites.find(c => c.nome === n) || {}).colore) || 'var(--brand)';
  openDialog(`
    <h3>📅 Programma</h3>
    <div class="plan-nav">
      <button class="btn ghost" value="prev" formnovalidate aria-label="Settimana prima">◀</button>
      <b>${esc(titolo)}</b>
      <button class="btn ghost" value="next" formnovalidate aria-label="Settimana dopo">▶</button>
    </div>
    ${planDirty ? '<p class="plan-dirty">Modifiche non salvate</p>' : ''}
    ${planHoursBox()}
    <div class="plan-days">${days.map(d => `
      <div class="plan-day">
        <div class="plan-day-h">${esc(dayLabel(d))}</div>
        ${PLAN_TURNI.map(t => {
          const sq = planSquads.filter(s => s.data === d && s.turno === t.nome);
          return `<div class="plan-turno"><small>${t.nome} ${t.orario}</small>
            ${sq.map(s => `<button class="plan-sq" value="edit:${esc(s.id)}" formnovalidate>
              <span class="dot" style="background:${esc(color(s.cantiere))}"></span>
              <span class="grow"><b>${esc(s.cantiere)}</b> ${s.operatori.map(o => `<span class="${isD(d, o) ? 'nm doppio' : 'nm'}">${esc(o)}</span>`).join(' ')}</span>
            </button>`).join('')}
            <button class="plan-add" value="add:${d}:${t.nome}" formnovalidate>+ Squadra</button></div>`;
        }).join('')}
        <button class="plan-ferie" value="ferie:${d}" formnovalidate>${assDay(planSquads, d) || '🌴 + Ferie, malattia, permesso'}</button>
      </div>`).join('')}</div>
    <p class="note"><span class="nm doppio">Nome</span> = doppio turno quel giorno.</p>
    <div class="menu">
      <button class="btn" value="save">💾 Salva il programma</button>
      <div class="row"><button class="btn ghost" value="pdf" formnovalidate>📄 PDF / stampa</button><button class="btn ghost" value="sharepdf" formnovalidate>📤 Condividi</button></div>
      <button class="btn ghost" value="copy" formnovalidate>📋 Copia la settimana prima</button>
      <button class="btn ghost" value="people" formnovalidate>👥 Operatori</button>
      <button class="btn ghost" value="back" formnovalidate>Indietro</button>
    </div>`, a => {
    if (a === 'prev' || a === 'next') {
      if (planDirty && !confirm('Ci sono modifiche non salvate. Cambiare settimana e perderle?')) return setTimeout(planView, 50);
      return setTimeout(() => adminPlan(addDays(planWeek, a === 'prev' ? -7 : 7)), 50);
    }
    if (a === 'save') return setTimeout(() => call('salvaprogramma', { da: planWeek, a: addDays(planWeek, 6), squadre: planSquads }, 'Salvo il programma', out => {
      planSquads = out.squadre || planSquads; planDirty = false; toast('Programma salvato ✓'); planView();
    }), 50);
    if (a === 'copy') return setTimeout(planCopyPrev, 50);
    if (a === 'pdf') return setTimeout(planPrint, 50);
    if (a === 'sharepdf') return setTimeout(planSharePdf, 50);
    if (a === 'people') return setTimeout(planPeopleEdit, 50);
    if (a === 'back') {
      if (planDirty && !confirm('Ci sono modifiche non salvate. Uscire e perderle?')) return setTimeout(planView, 50);
      return setTimeout(adminHome, 50);
    }
    if (a.startsWith('add:')) { const [, d, t] = a.split(':'); return setTimeout(() => planSquadEdit(null, d, t), 50); }
    if (a.startsWith('ferie:')) return setTimeout(() => planFerieEdit(a.slice(6)), 50);
    if (a.startsWith('edit:')) return setTimeout(() => planSquadEdit(a.slice(5)), 50);
  });
}
// Programma in PDF: una riga per giorno, mattina e pomeriggio, doppio turno in rosso
function planDoc() {
  const isD = doppi(planSquads);
  const fine = addDays(planWeek, 6);
  const dmy = iso => dayFromIso(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(planWeek, i));
  const cell = (d, t) => planSquads.filter(x => x.data === d && x.turno === t).map(x => `<div class="pp-sq">
      <b>${esc(x.cantiere)}</b>${x.operatori.map(o => `<span class="${isD(d, o) ? 'pp-n pp-d' : 'pp-n'}">${esc(o)}</span>`).join('')}${x.nota ? `<i>${esc(x.nota)}</i>` : ''}</div>`).join('') || '';
  return `<div class="plan-doc">
    <div class="pd-head"><img src="logo.png" alt="GE3CO"><div><h1>Programma ingombranti</h1>
      <p>Settimana dal <b>${dmy(planWeek)}</b> al <b>${dmy(fine)}</b></p></div></div>
    <table class="pd-t">
      <colgroup><col style="width:16%"><col style="width:42%"><col style="width:42%"></colgroup>
      <thead><tr><th></th>${PLAN_TURNI.map(t => `<th>${t.nome.toUpperCase()} ${t.orario.replace('–', '.00 – ')}.00</th>`).join('')}</tr></thead>
      <tbody>${days.map(d => `<tr><th class="pd-day">${esc(dayFromIso(d).toLocaleDateString('it-IT', { weekday: 'long' }))}<small>${dayFromIso(d).getDate()}</small>${assDay(planSquads, d) ? `<em>${assDay(planSquads, d, '<br>')}</em>` : ''}</th>
        ${PLAN_TURNI.map(t => `<td>${cell(d, t.nome)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="pd-note"><span class="pp-n pp-d">Nome</span> = doppio turno · Ogni turno vale ${cfg().oreTurno} ore · Dove non è indicato il cantiere vale PISA</p>
  </div>`;
}
function planPrint() {
  $('#printArea').innerHTML = planDoc();
  document.body.classList.add('print-modulo');
  const imgs = [...document.querySelectorAll('#printArea img')];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; setTimeout(ok, 3000); }))).then(() => {
    window.print();
    setTimeout(() => { document.body.classList.remove('print-modulo'); planView(); }, 300);
  });
}
async function planSharePdf() {
  busy('Preparo il PDF');
  const nome = `Programma ingombranti ${dayFromIso(planWeek).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }).replace('/', '-')}.pdf`;
  let file;
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff';
    box.innerHTML = planDoc();
    document.body.appendChild(box);
    try {
      await Promise.all([...box.querySelectorAll('img')].map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; setTimeout(ok, 3000); })));
      const c = await window.html2canvas(box.firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
      const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const w = 190, h = Math.min(277, c.height * w / c.width);
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, h < 277 ? w : 277 * c.width / c.height, h);
      file = new File([pdf.output('blob')], nome, { type: 'application/pdf' });
    } finally { box.remove(); }
  } catch (e) {
    return openDialog('<h3>Errore</h3><p>Non riesco a creare il PDF: serve la connessione. Puoi usare "PDF / stampa".</p><button class="btn" value="back">Indietro</button>', () => setTimeout(planView, 50));
  }
  openDialog(`<h3>📤 Condividi il programma</h3><p>${esc(nome)}</p>
    <p class="note">Si apre la condivisione: scegli WhatsApp (anche un gruppo) o Mail.</p>
    <button class="btn" value="share">📤 Condividi il PDF</button>
    <button class="btn ghost" value="back">Indietro</button>`, async a => {
    if (a === 'share') {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: nome }); } catch (e) { /* annullato */ }
      } else {
        const url = URL.createObjectURL(file);
        const l = document.createElement('a'); l.href = url; l.download = nome; document.body.appendChild(l); l.click(); l.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }
    setTimeout(planView, 300);
  });
}
// Specchietto delle ore della settimana: chi è sotto le sue ore, chi è giusto, chi sfora
function planHoursBox() {
  const ore = oreSettimana(planSquads);
  const names = new Map();
  planPeople.filter(p => p.attivo !== false).forEach(p => names.set(p.nome.trim().toLowerCase(), p.nome));
  Object.values(ore).forEach(x => names.set(x.nome.trim().toLowerCase(), names.get(x.nome.trim().toLowerCase()) || x.nome));
  if (!names.size) return '';
  const rows = [...names.entries()].map(([k, nome]) => {
    const x = ore[k] || { lavoro: 0, ferie: 0 };
    const tot = x.lavoro + x.ferie, max = oreContratto(nome), diff = tot - max;
    return { nome, x, tot, max, diff, st: diff > 0 ? 'over' : diff === 0 ? 'ok' : 'under' };
  }).sort((a, b) => ({ over: 0, under: 1, ok: 2 })[a.st] - ({ over: 0, under: 1, ok: 2 })[b.st] || (a.st === 'over' ? b.diff - a.diff : a.diff - b.diff) || a.nome.localeCompare(b.nome));
  const n = st => rows.filter(r => r.st === st).length;
  return `<details class="ore-box" ${planHoursOpen ? 'open' : ''} id="oreBox">
    <summary><b>⏱️ Ore della settimana</b>
      <span class="ore-cnt">${n('over') ? `<i class="o-over">${n('over')} oltre</i>` : ''}${n('under') ? `<i class="o-under">${n('under')} sotto</i>` : ''}${n('ok') ? `<i class="o-ok">${n('ok')} ok</i>` : ''}</span></summary>
    <div class="ore-grid">${rows.map(r => `<div class="ore-row o-${r.st}">
      <span class="ore-nome">${esc(r.nome)}</span>
      <span class="ore-num">${r.tot}/${r.max} h${r.x.ferie ? ` <small>🌴${r.x.ferie}</small>` : ''}</span>
      <span class="ore-diff">${r.diff > 0 ? `+${r.diff} oltre` : r.diff < 0 ? `mancano ${-r.diff}` : '✓'}</span>
      <span class="ore-bar"><span style="width:${Math.min(100, r.tot / r.max * 100)}%"></span></span>
    </div>`).join('')}</div>
    <p class="note">Ogni turno vale ${cfg().oreTurno} h, anche ferie, malattia e permesso (🌴 = ore di assenza). Le ore da contratto si cambiano in 👥 Operatori.</p>
  </details>`;
}
let planHoursOpen = true;
document.addEventListener('toggle', e => { if (e.target && e.target.id === 'oreBox') planHoursOpen = e.target.open; }, true);
function planFerieEdit(d) {
  const ore = oreSettimana(planSquads);
  const tipoDi = nome => (planSquads.find(x => x.data === d && isAss(x.turno) && x.operatori.some(o => sameName(o, nome))) || {}).turno || '';
  const occupato = nome => planSquads.some(x => x.data === d && !isAss(x.turno) && x.operatori.some(o => sameName(o, nome)));
  const people = planPeople.filter(p => p.attivo !== false || tipoDi(p.nome));
  openDialog(`
    <h3>🌴 Ferie, malattia, permesso</h3>
    <p class="note">${esc(dayLabel(d))} · ogni assenza conta ${cfg().oreTurno} ore</p>
    <div class="plan-people">${people.map((p, i) => {
      const x = ore[p.nome.trim().toLowerCase()] || { lavoro: 0, ferie: 0 };
      const diff = x.lavoro + x.ferie - oreContratto(p.nome);
      const cur = tipoDi(p.nome);
      return `<div class="pp pp-ore"><span><b>${esc(p.nome)}</b> <em class="${diff > 0 ? 'dop' : ''}">${x.lavoro + x.ferie}/${oreContratto(p.nome)} h${diff < 0 ? ` · mancano ${-diff}` : diff > 0 ? ` · ${diff} oltre` : ''}${occupato(p.nome) ? ' · in squadra quel giorno' : ''}</em></span>
        <select name="as${i}" aria-label="Assenza di ${esc(p.nome)}"><option value="">—</option>${ASSENZE.map(a => `<option value="${a.nome}" ${cur === a.nome ? 'selected' : ''}>${a.icona} ${a.nome}</option>`).join('')}</select></div>`;
    }).join('') || '<p class="note">Nessun operatore.</p>'}</div>
    <div class="row"><button class="btn ghost" value="cancel" formnovalidate>Annulla</button><button class="btn" value="ok">OK</button></div>`, (a, fd) => {
    if (a !== 'ok') return setTimeout(planView, 50);
    const vecchi = planSquads.filter(x => x.data === d && isAss(x.turno));
    planSquads = planSquads.filter(x => !(x.data === d && isAss(x.turno)));
    ASSENZE.forEach(as => {
      const ops = people.filter((p, i) => fd.get('as' + i) === as.nome).map(p => p.nome);
      const prima = vecchi.find(x => x.turno === as.nome);
      if (ops.length) planSquads.push({ id: prima ? prima.id : uid(), data: d, turno: as.nome, cantiere: as.nome.toUpperCase(), operatori: ops, nota: '' });
    });
    planDirty = true;
    setTimeout(planView, 50);
  });
}
function planSquadEdit(id, data, turno) {
  const s = id ? planSquads.find(x => x.id === id) : { id: uid(), data, turno, cantiere: '', operatori: [], nota: '' };
  if (!s) return planView();
  const names = planSites.map(c => c.nome);
  const def = s.cantiere || (names.includes('PISA') ? 'PISA' : names[0] || '');
  // Chi è già in un'altra squadra nello stesso giorno: stesso turno (occupato) o altro turno (diventa doppio)
  const altrove = (nome, stessoTurno) => planSquads.some(x => x.id !== s.id && !isAss(x.turno) && x.data === s.data && (x.turno === s.turno) === stessoTurno && x.operatori.some(o => sameName(o, nome)));
  const inFerie = nome => (planSquads.find(x => isAss(x.turno) && x.data === s.data && x.operatori.some(o => sameName(o, nome))) || {}).turno;
  const oreW = oreSettimana(planSquads.filter(x => x.id !== s.id));
  const oreTxt = nome => { const x = oreW[nome.trim().toLowerCase()] || { lavoro: 0, ferie: 0 }; return `${x.lavoro + x.ferie}/${oreContratto(nome)} h`; };
  const people = planPeople.filter(p => p.attivo !== false || s.operatori.some(o => sameName(o, p.nome)));
  const t = turnoInfo(s.turno);
  openDialog(`
    <h3>${id ? 'Modifica squadra' : 'Nuova squadra'}</h3>
    <p class="note">${esc(dayLabel(s.data))} · ${esc(t.nome)} ${esc(t.orario)}</p>
    <label>Cantiere<select name="cantiere">${names.concat(s.cantiere && !names.includes(s.cantiere) ? [s.cantiere] : []).map(n => `<option ${n === def ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    ${people.length ? [0, 1, 2, 3].map(i => `<label>Operatore ${i + 1}${i ? ' (facoltativo)' : ''}<select name="op">
      <option value="">${i ? '—' : 'Scegli…'}</option>
      ${people.map(p => {
        const occ = altrove(p.nome, true), dop = altrove(p.nome, false);
        const sel = s.operatori[i] && sameName(s.operatori[i], p.nome);
        return `<option value="${esc(p.nome)}" ${sel ? 'selected' : ''}>${esc(p.nome)} · ${oreTxt(p.nome)}${inFerie(p.nome) ? ' · IN ' + inFerie(p.nome).toUpperCase() : occ ? ' · già in squadra' : dop ? ' · doppio turno' : ''}</option>`;
      }).join('')}
    </select></label>`).join('') : '<p class="note">Nessun operatore: aggiungili da 👥 Operatori.</p>'}
    <label>Nota (facoltativa)<input name="nota" maxlength="200" value="${esc(s.nota || '')}" placeholder="es. corso, mezzo, indirizzo"></label>
    <div class="row">
      ${id ? '<button class="btn ghost danger-text" value="del" formnovalidate>Elimina</button>' : ''}
      <button class="btn ghost" value="cancel" formnovalidate>Annulla</button>
      <button class="btn" value="ok">OK</button>
    </div>`, (a, fd) => {
    if (a === 'cancel') return setTimeout(planView, 50);
    if (a === 'del') { planSquads = planSquads.filter(x => x.id !== s.id); planDirty = true; return setTimeout(planView, 50); }
    const ops = [...new Set(fd.getAll('op').map(String).filter(Boolean))];
    if (!ops.length) { alert('Scegli almeno un operatore.'); return false; }
    Object.assign(s, { cantiere: String(fd.get('cantiere') || def), operatori: ops, nota: String(fd.get('nota') || '').trim() });
    if (!id) planSquads.push(s);
    planDirty = true;
    setTimeout(planView, 50);
  });
}
function planCopyPrev() {
  const prev = addDays(planWeek, -7);
  call('programma', { da: prev, a: addDays(prev, 6) }, 'Copio la settimana prima', out => {
    const src = (out.squadre || []);
    if (!src.length) { toast('La settimana prima è vuota'); return planView(); }
    if (planSquads.length && !confirm('Sostituire il programma di questa settimana con quello della settimana prima?')) return planView();
    planSquads = src.map(s => Object.assign({}, s, { id: uid(), data: addDays(s.data, 7) }));
    planDirty = true;
    planView();
  });
}
function planPeopleEdit() {
  openDialog(`
    <h3>👥 Operatori</h3>
    <p class="note">Chi è spuntato compare nel programma. Chi ha già timbrato c'è già.</p>
    <div class="plan-people">${planPeople.map((p, i) => `<div class="pp pp-ore"><label><input type="checkbox" name="on" value="${i}" ${p.attivo !== false ? 'checked' : ''}><span>${esc(p.nome)}</span></label>
      <label class="ore-in"><input name="ore${i}" inputmode="numeric" value="${oreContratto(p.nome)}" aria-label="Ore settimanali di ${esc(p.nome)}"> h/sett.</label></div>`).join('')}</div>
    <label>Aggiungi operatori (uno per riga o separati da virgola)<textarea name="nuovo" rows="3" placeholder="es. Rossi&#10;Bianchi&#10;Mario Verdi"></textarea></label>
    <div class="row"><button class="btn ghost" value="cancel" formnovalidate>Indietro</button><button class="btn" value="ok">Salva</button></div>`, (a, fd) => {
    if (a === 'cancel') return setTimeout(planView, 50);
    const on = new Set(fd.getAll('on').map(Number));
    const lista = planPeople.map((p, i) => ({ nome: p.nome, attivo: on.has(i), ore: Number(String(fd.get('ore' + i) || '').replace(',', '.')) || ORE_DEFAULT }));
    db.oreOp = Object.assign({}, db.oreOp);
    lista.forEach(p => { db.oreOp[p.nome.trim().toLowerCase()] = p.ore; });
    save();
    const cap = v => String(v || '').trim().replace(/\s+/g, ' ').replace(/(^|[\s'-])\S/g, c => c.toUpperCase());
    String(fd.get('nuovo') || '').split(/[\n,;]+/).map(v => cap(String(v).toLowerCase())).filter(Boolean).forEach(nuovo => {
      // Un cognome già presente come "Nome Cognome" non si duplica
      const giaC = lista.some(p => sameName(p.nome, nuovo) || sameName(p.nome.split(' ').slice(-1)[0], nuovo));
      if (!giaC) lista.push({ nome: nuovo, attivo: true, ore: ORE_DEFAULT });
    });
    setTimeout(() => call('operatori', { operatori: lista }, 'Salvo gli operatori', out => {
      planPeople = (out.operatori || lista).map(p => Object.assign({}, p, { ore: Number(p.ore) > 0 ? Number(p.ore) : (lista.find(l => sameName(l.nome, p.nome)) || {}).ore }));
      toast('Operatori salvati ✓'); planView();
    }), 50);
  });
}

// ---------- Modulo ore settimanale (modello cartaceo GE3CO) ----------
// Compila il modulo "Settimana DAL … AL …" con le timbrature del telefono: un blocco per cantiere,
// ora inizio / ora fine / totale per ogni giorno. Se i cantieri sono più di 4 si aggiunge un secondo modulo.
const MOD_GIORNI = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];
const MOD_BLOCCHI = 4;
const hm = ms => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
let modWeek = null;
// Si apre già compilato sulla settimana scorsa (si consegna il martedì per la settimana prima)
function modPick() { modShow(modWeek || addDays(mondayOf(new Date()), -7)); }
function modSettings(week) {
  const m = db.modulo || {};
  openDialog(`
    <h3>⚙️ Impostazioni modulo</h3>
    <label>Tipologia intervento<input name="tipo" maxlength="30" value="${esc(m.tipo || 'Ingombranti')}"></label>
    <label>Prima del cantiere (facoltativo)<input name="pref" maxlength="20" value="${esc(m.pref || '')}" placeholder="es. Geofor → Geofor Cascina"></label>
    <label class="adm-on"><input type="checkbox" name="prove" ${m.prove !== false ? 'checked' : ''}> Includi le timbrature fatte in modalità prova</label>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Annulla</button><button class="btn" value="ok">Salva</button></div>`, (a, fd) => {
    if (a === 'ok') { db.modulo = { tipo: String(fd.get('tipo') || '').trim(), pref: String(fd.get('pref') || '').trim(), prove: fd.get('prove') === 'on' }; save(); }
    setTimeout(() => modShow(week), 50);
  });
}
function modBlocks(week) {
  const da = dayFromIso(week).getTime(), a = dayFromIso(addDays(week, 7)).getTime();
  const conProve = (db.modulo || {}).prove !== false;
  const shifts = db.shifts.filter(s => s.end && s.start >= da && s.start < a && (conProve || !s.demo)).sort((x, y) => x.start - y.start);
  const blocks = [];
  shifts.forEach(s => {
    const name = siteById(s.siteId).name;
    const day = (new Date(s.start).getDay() + 6) % 7;
    let b = blocks.find(x => x.cantiere === name && !x.giorni[day]);
    if (!b) { b = { cantiere: name, giorni: [] }; blocks.push(b); }
    b.giorni[day] = s;
  });
  return { blocks, shifts };
}
function modDoc(week) {
  const m = db.modulo || {};
  const { blocks, shifts } = modBlocks(week);
  const fine = addDays(week, 6);
  const dmy = iso => dayFromIso(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const nome = db.user ? `${db.user.last} ${db.user.first}`.toUpperCase() : '';
  const pagine = [];
  for (let i = 0; i < Math.max(1, blocks.length); i += MOD_BLOCCHI) pagine.push(blocks.slice(i, i + MOD_BLOCCHI));
  // Ore di cantiere fisse: ogni turno vale oreTurno ore, con l'orario di servizio del turno (06–11 o 13–18)
  const ore = cfg().oreTurno;
  const orari = s => {
    const pom = (fascia(s.start) || {}).nome === 'Pomeriggio' || new Date(s.start).getHours() >= 12;
    const h0 = pom ? 13 : 6;
    return { in: `${pad(h0)}:00`, out: `${pad(h0 + Math.floor(ore))}:${pad(Math.round((ore % 1) * 60))}`, tot: hm(ore * 3600000) };
  };
  const cell = (b, d, k) => {
    const s = b && b.giorni[d];
    return s ? `<td>${orari(s)[k === 'in' ? 'in' : k === 'out' ? 'out' : 'tot']}</td>` : '<td></td>';
  };
  const block = b => `
    <tr class="mod-r1"><td class="mod-lab" rowspan="3"><div><span>cantiere</span><b>${b ? esc([m.pref, b.cantiere].filter(Boolean).join(' ')) : ''}</b></div>
      <div><span>tip. intervento</span><b>${b ? esc(m.tipo || '') : ''}</b></div></td>
      <td class="mod-k">ora inizio</td>${MOD_GIORNI.map((_, d) => cell(b, d, 'in')).join('')}</tr>
    <tr><td class="mod-k">ora fine</td>${MOD_GIORNI.map((_, d) => cell(b, d, 'out')).join('')}</tr>
    <tr class="mod-r3"><td class="mod-k">tot. ore</td>${MOD_GIORNI.map((_, d) => cell(b, d, 'tot')).join('')}</tr>`;
  const one = lista => `<div class="modulo">
    <div class="mod-head">
      <div class="mod-f mod-nome"><span>COGNOME e NOME</span><b>${esc(nome)}</b></div>
      <div class="mod-f"><span>Settimana DAL</span><b>${dmy(week)}</b></div>
      <div class="mod-f"><span>AL</span><b>${dmy(fine)}</b></div>
    </div>
    <table class="mod-t">
      <colgroup><col class="c-lab"><col class="c-k">${MOD_GIORNI.map(() => '<col class="c-d">').join('')}</colgroup>
      <thead><tr><th colspan="2"></th>${MOD_GIORNI.map((g, d) => `<th>${g}<small>${dayFromIso(addDays(week, d)).getDate()}</small></th>`).join('')}</tr></thead>
      <tbody>${[0, 1, 2, 3].map(i => block(lista[i])).join('')}</tbody>
    </table>
    <div class="mod-foot">
      <img src="logo.png" alt="GE3CO Gestione Ecologia">
      <p>Consegnare questo modulo compilato tassativamente entro il MARTEDÌ della settimana successiva al proprio Caposquadra o nell'apposita cassettina della sede di Pontedera. Il foglio dell'ultima settimana del mese deve invece pervenire entro il giorno 2 del mese successivo. Specificare bene il cantiere (es: Geofor Cascina) e la tipologia di intervento (es: RSU).<br>
      Il lavoratore sarà chiamato a rispondere in caso di anomalia tra quanto da esso dichiarato e quanto previsto dagli ordini di servizio. La ripetizione di eventuali abusi sarà punita conformemente a quanto prevede il nostro CCNL.</p>
    </div>
  </div>`;
  const tot = shifts.length * cfg().oreTurno * 3600000;
  return { html: pagine.map(one).join('<div class="mod-cut"></div>'), turni: shifts.length, tot, moduli: pagine.length, prove: shifts.filter(s => s.demo).length };
}
// Crea il PDF del modulo sul telefono e lo condivide (WhatsApp, email…) al responsabile
const loadScript = src => new Promise((ok, ko) => {
  if (document.querySelector(`script[src="${src}"]`)) return ok();
  const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = ko; document.head.appendChild(el);
});
async function modPdf(r) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;padding:0';
  box.innerHTML = r.html;
  document.body.appendChild(box);
  try {
    await Promise.all([...box.querySelectorAll('img')].map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; setTimeout(ok, 3000); })));
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const forms = [...box.querySelectorAll('.modulo')];
    let y = 10;
    for (const f of forms) {
      const c = await window.html2canvas(f, { scale: 2, backgroundColor: '#ffffff' });
      const w = 190, h = c.height * w / c.width;
      if (y + h > 287) { pdf.addPage(); y = 10; }
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 10, y, w, h);
      y += h + 8;
    }
    return pdf.output('blob');
  } finally { box.remove(); }
}
async function modSend(week, r) {
  busy('Preparo il PDF');
  const fine = addDays(week, 6);
  const dm = iso => dayFromIso(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  const nome = `Modulo ore ${db.user ? db.user.last : ''} ${dm(week).replace('/', '-')} al ${dm(fine).replace('/', '-')}.pdf`.replace(/\s+/g, ' ');
  const text = `Modulo ore settimana dal ${dm(week)} al ${dm(fine)} – ${fullName()}`;
  let file;
  try { file = new File([await modPdf(r)], nome, { type: 'application/pdf' }); }
  catch (e) { return openDialog(`<h3>Errore</h3><p>Non riesco a creare il PDF: serve la connessione la prima volta. Puoi usare "Salva PDF / stampa".</p><button class="btn" value="back">Indietro</button>`, () => setTimeout(() => modShow(week), 50)); }
  const c = cfg();
  openDialog(`
    <h3>📤 Invia il modulo</h3>
    <p>${esc(nome)}</p>
    <p class="note">Si apre la condivisione del telefono: scegli WhatsApp${c.autorizzaNome ? ` e poi ${esc(c.autorizzaNome)}` : ''}, oppure Mail.</p>
    <button class="btn" value="share">📤 Condividi il PDF</button>
    <button class="btn ghost" value="back">Indietro</button>`, async a => {
    if (a === 'back') return setTimeout(() => modShow(week), 50);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nome, text }); } catch (e) { /* annullato */ }
    } else {
      // Telefono senza condivisione file: scarica il PDF e apre WhatsApp con il messaggio
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = nome; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      window.open(`https://wa.me/${c.autorizzaTelefono || ''}?text=${encodeURIComponent(text + ' (PDF scaricato, allegalo qui)')}`, '_blank');
    }
    setTimeout(() => modShow(week), 300);
  });
}
function modShow(week) {
  const r = modDoc(week);
  openDialog(`
    <h3>📝 Modulo ore</h3>
    <label class="mod-cal">📅 Settimana del<input type="date" id="modDate" value="${week}"></label>
    <p class="note">${r.turni ? `${r.turni} turn${r.turni === 1 ? 'o' : 'i'} · ${hm(r.tot)} ore${r.moduli > 1 ? ` · ${r.moduli} moduli (più di 4 cantieri)` : ''}${r.prove ? ` · di cui ${r.prove} in modalità prova` : ''}` : 'Nessuna timbratura in questa settimana.'}</p>
    <div class="mod-wrap"><div class="mod-scale">${r.html}</div></div>
    <div class="menu">
      <button class="btn" value="send" ${r.turni ? '' : 'disabled'}>📤 Invia a ${esc(cfg().autorizzaNome || 'responsabile')}</button>
      <button class="btn ghost" value="print">📄 Salva PDF / stampa</button>
      <div class="row"><button class="btn ghost" value="prev">◀ Sett. prima</button><button class="btn ghost" value="next">Sett. dopo ▶</button></div>
      <div class="row"><button class="btn ghost" value="set">⚙️ Impostazioni</button><button class="btn ghost" value="back">Chiudi</button></div>
    </div>`, a => {
    if (a === 'prev' || a === 'next') { modWeek = addDays(week, a === 'prev' ? -7 : 7); return setTimeout(() => modShow(modWeek), 50); }
    if (a === 'set') return setTimeout(() => modSettings(week), 50);
    if (a === 'send') return setTimeout(() => modSend(week, r), 50);
    if (a === 'back') return;
    if (a === 'print') setTimeout(() => {
      $('#printArea').innerHTML = `<div class="mod-print">${r.html}</div>`;
      document.body.classList.add('print-modulo');
      // Aspetta che il logo sia caricato, altrimenti nel PDF non compare
      const imgs = [...document.querySelectorAll('#printArea img')];
      Promise.all(imgs.map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; setTimeout(ok, 3000); }))).then(() => {
        window.print();
        setTimeout(() => { document.body.classList.remove('print-modulo'); modShow(week); }, 300);
      });
    }, 50);
  });
  // Scelta del giorno dal calendario: il modulo si ricompila da solo sulla settimana di quel giorno
  const cal = $('#modDate');
  if (cal) cal.onchange = () => { if (cal.value) { modWeek = mondayOf(dayFromIso(cal.value)); modShow(modWeek); } };
  // Anteprima rimpicciolita per stare nello schermo del telefono
  const wrap = $('#dlgBody .mod-wrap'), sc = $('#dlgBody .mod-scale');
  if (wrap && sc) {
    const k = Math.min(1, (wrap.clientWidth - 16) / 720);
    sc.style.transform = `scale(${k})`;
    sc.style.height = '0';
    sc.parentElement.style.height = `${sc.scrollHeight * k + 16}px`;
  }
}

// ---------- Stima busta paga (solo su questo telefono) ----------
// Calcola da solo una busta del mese scelto: stipendio mensile fisso + ore extra dalle timbrature,
// contributi, IRPEF con detrazioni da lavoro dipendente e cuneo fiscale, addizionali stimate.
// Senza dati dell'azienda: è una stima. Paga oraria e ore le inserisce l'operatore e restano sul telefono.
const PAGA_DEFAULT = { oraria: 0, ore: 0, magg: 30, inps: 9.76, addiz: true, sind: 0, piu: 0 };
const euro = v => (Math.round(v * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numIt = v => (v === undefined || v === null || v === '') ? '' : String(v).replace('.', ',');
const parseIt = v => Number(String(v || '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
const paga = () => Object.assign({}, PAGA_DEFAULT, db.paga && db.paga.v === 2 ? db.paga : {});
function paySettings(then) {
  const p = paga();
  const f = (name, label, v, note) => `<label>${label}<input name="${name}" inputmode="decimal" value="${esc(numIt(v))}">${note ? `<small class="note">${note}</small>` : ''}</label>`;
  openDialog(`
    <h3>⚙️ Dati per la stima</h3>
    <p class="note">Li trovi su una tua busta paga. Restano solo su questo telefono: non vanno al responsabile né al foglio.</p>
    ${f('oraria', 'Paga oraria lorda (€)', p.oraria || '', 'Sulla busta: la base della voce "lavoro ordinario"')}
    ${f('ore', 'Ore al mese da contratto', p.ore || '', 'Ore settimanali × 4,33')}
    ${f('magg', 'Maggiorazione ore extra (%)', p.magg)}
    ${f('inps', 'Contributi INPS (%)', p.inps)}
    <label class="adm-on"><input type="checkbox" name="addiz" ${p.addiz ? 'checked' : ''}> Trattieni le addizionali regionale e comunale</label>
    ${f('sind', 'Trattenuta sindacale al mese (€)', p.sind || '', 'Lascia vuoto se non sei iscritto')}
    ${f('piu', 'Altre voci nette in più al mese (€)', p.piu || '', 'Per esempio incrementi contrattuali; altrimenti vuoto')}
    <div class="row"><button class="btn ghost" value="" formnovalidate>Annulla</button><button class="btn" value="save">Salva</button></div>`,
    (a, fd) => {
      const v = k => parseIt(fd.get(k));
      const n = { v: 2, oraria: v('oraria'), ore: v('ore'), magg: v('magg'), inps: v('inps'), addiz: fd.get('addiz') === 'on', sind: v('sind'), piu: v('piu') };
      if (!(n.oraria > 0 && n.ore > 0)) { alert('Servono almeno la paga oraria e le ore al mese.'); return false; }
      db.paga = n;
      save();
      setTimeout(then || payPick, 50);
    });
}
let payMonth = null, payMode = 'fine';
function payPick() {
  const p = paga();
  if (!(p.oraria > 0 && p.ore > 0)) return paySettings(payPick);
  openDialog(`
    <h3>💶 Stima busta paga</h3>
    <p>${esc(fullName() || 'Operatore')}</p>
    <label>Mese<input type="month" name="mese" required value="${payMonth || monthNow()}"></label>
    <div class="motivi">
      <label><input type="radio" name="modo" value="fine" ${payMode === 'fine' ? 'checked' : ''}> A fine mese</label>
      <label><input type="radio" name="modo" value="oggi" ${payMode === 'oggi' ? 'checked' : ''}> Maturato a oggi</label>
    </div>
    <button class="btn" value="gen">Genera</button>
    <button class="btn ghost" value="set" formnovalidate>⚙️ Dati per la stima</button>`,
    (a, fd) => {
      if (a === 'set') return setTimeout(() => paySettings(payPick), 50);
      payMonth = String(fd.get('mese'));
      payMode = String(fd.get('modo') || 'fine');
      setTimeout(() => payShow(payMonth), 50);
    });
}
// IRPEF annua 2026: 23% fino a 28.000, 33% fino a 50.000, 43% oltre
const irpefAnnua = r => r <= 28000 ? r * 0.23 : r <= 50000 ? 6440 + (r - 28000) * 0.33 : 13700 + (r - 50000) * 0.43;
// Detrazione per lavoro dipendente (art. 13 TUIR), annua
const detrLavoro = r => r <= 15000 ? 1955 : r <= 28000 ? 1910 + 1190 * (28000 - r) / 13000 : r <= 50000 ? 1910 * (50000 - r) / 22000 : 0;
// Cuneo fiscale (L. 207/2024): sotto 20.000 € somma esente in busta, da 20.000 a 40.000 € ulteriore detrazione
const cuneoSomma = (r, lav) => r <= 8500 ? lav * 0.071 : r <= 15000 ? lav * 0.053 : r <= 20000 ? lav * 0.048 : 0;
const cuneoDetr = r => r > 20000 && r <= 32000 ? 1000 : r > 32000 && r <= 40000 ? 1000 * (40000 - r) / 8000 : 0;
const ADDIZ_PERC = 2.3; // regionale Toscana + comunale, stima media
// Netto che resta di un'ora extra lorda (contributi + IRPEF al 23%)
const NETTO_EXTRA = (1 - 0.0976) * (1 - 0.23);
function payCalc(m) {
  const p = paga();
  const [y, mo] = m.split('-').map(Number);
  const da = new Date(y, mo - 1, 1).getTime(), a = new Date(y, mo, 1).getTime();
  const mine = db.shifts.filter(s => s.start >= da && s.start < a && s.end && !s.demo);
  const r2 = v => Math.round(v * 100) / 100;
  // Quota del mese: intera a fine mese, oppure i giorni passati fino a oggi
  const giorniMese = new Date(y, mo, 0).getDate();
  const oggi = new Date();
  const passati = Date.now() >= a ? giorniMese : Date.now() < da ? 0 : oggi.getDate();
  const frac = payMode === 'oggi' ? passati / giorniMese : 1;
  // Ore extra: dalle timbrature, oltre il turno da 5 ore. In busta solo se autorizzate: qui restano a parte.
  const extraH = r2(mine.reduce((t, s) => t + extraMin(s), 0) / 60);
  const pagaExtra = p.oraria * (1 + (p.magg || 0) / 100);
  const extraLordo = r2(extraH * pagaExtra);
  const extraNetto = r2(extraLordo * NETTO_EXTRA);
  const ordinario = r2(p.oraria * p.ore * frac);
  const lordo = ordinario;
  const inps = r2(lordo * (p.inps || 0) / 100);
  const imponibile = r2(lordo - inps);
  const annuo = p.oraria * p.ore * (1 - (p.inps || 0) / 100) * 13;
  const irpefLorda = r2(irpefAnnua(imponibile / (frac || 1) * 12) / 12 * frac);
  const detr = r2((detrLavoro(annuo) + cuneoDetr(annuo)) / 12 * frac);
  const irpef = r2(Math.max(0, irpefLorda - detr));
  const cuneo = r2(cuneoSomma(annuo, p.oraria * p.ore * 13) / 12 * frac);
  const addiz = p.addiz ? r2(annuo * ADDIZ_PERC / 100 / 12 * frac) : 0;
  const sind = r2((p.sind || 0) * frac), piu = r2((p.piu || 0) * frac);
  const tratt = r2(inps + irpef + addiz + sind);
  const netto = r2(lordo + cuneo + piu - tratt);
  return { p, y, mo, frac, passati, giorniMese, turni: mine.length, giorni: new Set(mine.map(s => new Date(s.start).toDateString())).size,
    extraH, ordinario, pagaExtra, extraLordo, extraNetto, lordo, inps, imponibile, irpefLorda, detr, irpef, cuneo, addiz, sind, piu, tratt, netto };
}
function payDoc(c) {
  const p = c.p;
  const mese = new Date(c.y, c.mo - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }).toUpperCase();
  const row = (d, det, comp, tr) => `<tr><td>${d}${det ? `<small>${det}</small>` : ''}</td><td>${comp}</td><td>${tr}</td></tr>`;
  return `<div class="busta">
    <div class="busta-head">
      <div><span>Operatore</span><b>${esc((fullName() || 'Operatore').toUpperCase())}</b></div>
      <div><span>Mese</span><b>${esc(mese)}</b></div>
    </div>
    <div class="busta-info">
      <div><span>Turni</span>${c.turni}</div>
      <div><span>Giorni</span>${c.giorni}</div>
      <div><span>Ore extra</span>${numIt(c.extraH)}</div>
    </div>
    <table class="busta-voci">
      <thead><tr><th>Voce</th><th>Competenze</th><th>Trattenute</th></tr></thead>
      <tbody>
        ${row('Lavoro ordinario', `${numIt(p.ore)} h × ${numIt(p.oraria)}${c.frac < 1 ? ` · ${c.passati} giorni su ${c.giorniMese}` : ''}`, euro(c.ordinario), '')}
        ${c.cuneo ? row('Somma esente cuneo fiscale', 'L. 207/2024', euro(c.cuneo), '') : ''}
        ${row('Contributi INPS', `${numIt(p.inps)}% su ${euro(c.lordo)}`, '', euro(c.inps))}
        ${row('IRPEF', `${euro(c.irpefLorda)} su ${euro(c.imponibile)} − detrazioni ${euro(c.detr)}`, '', euro(c.irpef))}
        ${c.addiz ? row('Addizionali regionale e comunale', 'stima', '', euro(c.addiz)) : ''}
        ${c.sind ? row('Trattenuta sindacale', '', '', euro(c.sind)) : ''}
        ${c.piu ? row('Altre voci nette', '', euro(c.piu), '') : ''}
      </tbody>
    </table>
    <div class="busta-tot">
      <div><span>Totale lordo</span>${euro(c.lordo + c.cuneo)}</div>
      <div><span>Totale trattenute</span>${euro(c.tratt)}</div>
      <div class="netto"><span>Netto stimato${c.frac < 1 ? ' maturato a oggi' : ' a fine mese'}</span>${euro(c.netto)} €</div>
    </div>
    ${c.extraH ? `<div class="busta-extra"><b>Ore extra da autorizzare: ${numIt(c.extraH)} h</b>
      Non sono nel netto: entrano in busta solo se il responsabile le autorizza. Se autorizzate tutte: circa +${euro(c.extraNetto)} € netti (${euro(c.extraLordo)} € lordi${p.magg ? `, +${numIt(p.magg)}%` : ''}).</div>` : ''}
    <p class="busta-note">Stima calcolata dall'app sulle timbrature di questo telefono. Non è un cedolino. Ogni turno vale ${cfg().oreTurno} ore; lo stipendio è mensile fisso. Malattia, assenze, festività e conguagli possono cambiare la cifra.${c.addiz ? ` Se quest'anno le addizionali non te le trattengono, il netto sale di ${euro(c.addiz)} €.` : ''}</p>
  </div>`;
}
function payShow(m) {
  const c = payCalc(m);
  openDialog(`
    <h3>💶 Stima busta paga</h3>
    <div class="busta-wrap">${payDoc(c)}</div>
    <div class="menu">
      <button class="btn" value="print">📄 Salva PDF / stampa</button>
      <button class="btn ghost" value="back">Cambia mese</button>
    </div>`, a => {
    if (a === 'back') setTimeout(payPick, 50);
    if (a === 'print') setTimeout(() => {
      $('#printArea').innerHTML = `<h1>Stima busta paga</h1>${payDoc(c)}`;
      window.print();
      setTimeout(() => payShow(m), 300);
    }, 50);
  });
}

// ---------- Profilo dipendente ----------
function editProfile(then) {
  const u = db.user || { first: '', last: '' };
  const first = !db.user;
  openDialog(`
    <h3>${first ? 'Benvenuto!' : 'Il tuo nome'}</h3>
    <p>${first ? 'Inserisci nome e cognome: compariranno sulle tue timbrature.' : 'Nome e cognome che compaiono sulle timbrature.'}</p>
    <label>Nome<input name="first" required maxlength="40" autocomplete="given-name" value="${esc(u.first)}"></label>
    <label>Cognome<input name="last" required maxlength="40" autocomplete="family-name" value="${esc(u.last)}"></label>
    <div class="row">
      ${first ? '' : '<button class="btn ghost" value="" formnovalidate>Annulla</button>'}
      <button class="btn" value="save">${first ? 'Inizia' : 'Salva'}</button>
    </div>`, (action, fd) => {
    const cap = v => String(v || '').trim().replace(/\s+/g, ' ').replace(/(^|[\s'-])\S/g, c => c.toUpperCase());
    const f = cap(fd.get('first')), l = cap(fd.get('last'));
    if (!f || !l) return false;
    const changed = db.user && (db.user.first !== f || db.user.last !== l);
    db.user = { first: f, last: l, device: (db.user && db.user.device) || uid() };
    if (changed) resyncAll();
    save();
    if (then) setTimeout(then, 50);
  });
  // Al primo avvio il nome è obbligatorio: niente chiusura con Esc.
  dlg.oncancel = first ? e => e.preventDefault() : null;
  if (first) $('#dlgBody .dlg-x').remove();
}
$('#btnWho').onclick = () => editProfile();

// ---------- Registro aziendale (Google Sheet) ----------
// Ogni modifica va in coda e viene inviata appena c'è rete: funziona anche senza campo.
function enqueue(op) {
  op.opId = uid();
  // Per la stessa timbratura conta solo l'ultima operazione.
  const keyOf = o => o.shift ? o.shift.id : o.assenza ? o.assenza.id : o.intervento ? 'int' + o.intervento.id : o.id;
  const key = keyOf(op);
  db.queue = db.queue.filter(o => keyOf(o) !== key);
  db.queue.push(op);
}
function enqueueUpsert(s) {
  enqueue({ type: 'upsert', shift: { id: s.id, start: s.start, end: s.end || null, site: siteById(s.siteId).name,
    extra: s.extra || null, posIn: s.posIn || null, posOut: s.posOut || null, demo: !!s.demo } });
}
function enqueueDelete(id) { enqueue({ type: 'delete', id }); }
function resyncAll() {
  const from = Date.now() - 62 * 864e5; // ultimi 2 mesi
  db.shifts.filter(s => s.start >= from).forEach(enqueueUpsert);
  if (db.active) enqueueUpsert({ id: db.active.id, siteId: db.active.siteId, start: db.active.start, end: null });
}
function syncStatus() {
  if (!db.endpoint) return 'Registro aziendale: non collegato.';
  if (!db.queue.length) return 'Registro aziendale: collegato ✓ tutto inviato.';
  return `Registro aziendale: collegato, ${db.queue.length} da inviare (partono appena c'è rete).`;
}
let flushing = false;
async function flush() {
  if (flushing || !db.endpoint || !db.queue.length || !db.user || navigator.onLine === false) return;
  flushing = true;
  try {
    const ops = db.queue.slice(0, 50);
    // Corpo text/plain: richiesta "semplice", Google Apps Script la accetta senza preflight CORS.
    const res = await fetch(db.endpoint, {
      method: 'POST',
      body: JSON.stringify({ user: { name: fullName(), device: db.user.device }, ops, codice: db.codice || '' }),
    });
    const out = await res.json();
    if (!out.ok && out.error === 'codice' && !flush.warned) { flush.warned = true; toast('Per inviare le timbrature apri il link di invito del responsabile'); }
    if (out.ok) {
      const done = new Set(out.done);
      db = Object.assign(load(), { endpoint: db.endpoint, queue: (load().queue || []).filter(o => !done.has(o.opId)) });
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* */ }
      if (db.queue.length) setTimeout(flush, 500);
    }
  } catch (e) { /* offline o server non raggiungibile: si riprova dopo */ }
  flushing = false;
}
// Elenco cantieri preso dal Google Sheet del responsabile (scheda "Cantieri").
// I cantieri già presenti mantengono il loro id, così le timbrature restano collegate.
async function syncSites() {
  if (!db.endpoint || navigator.onLine === false) return;
  try {
    const res = await fetch(ep('azione=cantieri'));
    const out = await res.json();
    if (!out.ok || !Array.isArray(out.cantieri)) return;
    if (out.config && JSON.stringify(out.config) !== JSON.stringify(db.config)) { db.config = out.config; save(); }
    applyReset();
    const names = out.cantieri;
    const byName = new Map(db.sites.map(s => [s.name, s]));
    const visible = names.map((name, i) => {
      const old = byName.get(name);
      const color = (out.colori && out.colori[name]) || (old ? old.color : COLORS[i % COLORS.length]);
      return { id: old ? old.id : uid() + i, name, color };
    });
    // Quelli tolti dal foglio restano nascosti per i nomi nel registro.
    const hidden = db.sites.filter(s => !names.includes(s.name)).map(s => Object.assign({}, s, { hidden: true }));
    const next = visible.concat(hidden.filter(h => !visible.some(v => v.id === h.id)));
    if (JSON.stringify(next) !== JSON.stringify(db.sites)) { db.sites = next; save(); }
  } catch (e) { /* offline: si tengono i cantieri già scaricati */ }
}

// Il responsabile ha azzerato il registro ("parti da zero"): via le timbrature locali precedenti.
function applyReset() {
  const at = cfg().resetAt || 0;
  if (!at || (db.resetAt || 0) >= at) return;
  const old = new Set(db.shifts.filter(s => s.start < at).map(s => s.id));
  if (db.active && db.active.start < at) { old.add(db.active.id); db.active = null; }
  db.shifts = db.shifts.filter(s => !old.has(s.id));
  db.queue = db.queue.filter(o => o.assenza ? false : !(o.shift ? old.has(o.shift.id) || o.shift.start < at : true));
  db.assenze = [];
  db.resetAt = at;
  save();
}

// ---------- Ore extra oltre il turno standard (5 ore) ----------
const cfg = () => Object.assign({ oreTurno: 5, tolleranzaMin: 15, autorizzaNome: '', autorizzaTelefono: '' }, db.config || {});
// Fascia del turno dall'ora di entrata (come nello script): dalle 5 alle 12 mattina, 12–21 pomeriggio
function fascia(t) {
  const d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
  const turni = cfg().turni || [{ nome: 'Mattina', inizio: '05:00', fine: '11:00' }, { nome: 'Pomeriggio', inizio: '13:00', fine: '18:00' }];
  const inizioMattina = Number(turni[0].inizio.slice(0, 2)) + Number(turni[0].inizio.slice(3, 5)) / 60;
  if (h >= inizioMattina && h < 12) return turni[0];
  if (h >= 12 && h < 21) return turni[1];
  return null;
}
const fasciaLabel = t => { const f = fascia(t); return f ? `Turno ${f.nome.toLowerCase()} (${f.inizio}–${f.fine})` : 'Turno fuori orario'; };

// Minuti oltre il turno standard (0 se entro la tolleranza)
function extraMin(s) {
  if (!s.end) return 0;
  const c = cfg(), min = Math.round((s.end - s.start) / 60000);
  return min > c.oreTurno * 60 + c.tolleranzaMin ? min - c.oreTurno * 60 : 0;
}
function afterClockOut(shift, viaNfc) {
  if (extraMin(shift)) return setTimeout(() => justifyExtra(shift), 50);
  if (viaNfc) showBigOk('Uscita', siteById(shift.siteId).name,
    `${fmtTime(shift.start)} → ${fmtTime(shift.end)} · ${fmtDur(shift.end - shift.start)}`, shift.undo);
}
const MOTIVI = ['Guasto del mezzo', 'Foratura', 'Incidente', 'Altro'];
function justifyExtra(shift, msg) {
  $('#toast').hidden = true;
  const c = cfg();
  openDialog(`
    <h3>⏱️ Turno oltre le ${c.oreTurno} ore</h3>
    <p>${esc(siteById(shift.siteId).name)} · ${fmtTime(shift.start)} → ${fmtTime(shift.end)} = <b>${fmtDur(shift.end - shift.start)}</b>
      (${fmtDur(extraMin(shift) * 60000)} in più). Le ore extra vanno giustificate e autorizzate${c.autorizzaNome ? ' da ' + esc(c.autorizzaNome) : ''}.</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <div class="motivi">${MOTIVI.map((m, i) => `<label><input type="radio" name="motivo" value="${m}" ${i === 0 ? 'required' : ''}> ${m}</label>`).join('')}</div>
    <label>Cosa è successo<textarea name="nota" rows="3" maxlength="300" placeholder="Es. foratura sulla SS67, attesa carro attrezzi"></textarea></label>
    <button class="btn" value="ok">Conferma</button>
    <button class="btn ghost" value="undo" formnovalidate>Ho sbagliato a timbrare l'uscita</button>`,
    (a, fd) => {
      if (a === 'undo') { shift.undo(); toast('Uscita annullata: il turno è ancora aperto'); return; }
      const motivo = String(fd.get('motivo') || ''), nota = String(fd.get('nota') || '').trim();
      if (!motivo) return setTimeout(() => justifyExtra(shift, 'Scegli il motivo.'), 50);
      if (motivo === 'Altro' && !nota) return setTimeout(() => justifyExtra(shift, 'Scrivi cosa è successo.'), 50);
      const s = db.shifts.find(x => x.id === shift.id) || shift;
      s.extra = { motivo, nota };
      enqueueUpsert(s);
      save();
      setTimeout(() => askAuthorization(s), 50);
    });
  dlg.oncancel = e => e.preventDefault(); // la giustificazione è obbligatoria
  $('#dlgBody .dlg-x').remove();
}
function authMessage(s) {
  return [`*Richiesta autorizzazione ore extra*`,
    `Dipendente: ${fullName()}`,
    `Cantiere: ${siteById(s.siteId).name}`,
    `Data: ${new Date(s.start).toLocaleDateString('it-IT')}`,
    `Orario: ${fmtTime(s.start)} → ${fmtTime(s.end)} (${fmtDur(s.end - s.start)})`,
    `Ore extra: ${fmtDur(extraMin(s) * 60000)}`,
    `Motivo: ${s.extra.motivo}${s.extra.nota ? ' – ' + s.extra.nota : ''}`].join('\n');
}
function askAuthorization(s) {
  const c = cfg();
  const url = `https://wa.me/${c.autorizzaTelefono || ''}?text=${encodeURIComponent(authMessage(s))}`;
  openDialog(`
    <h3>📲 Chiedi l'autorizzazione</h3>
    <p>Manda la richiesta${c.autorizzaNome ? ' a <b>' + esc(c.autorizzaNome) + '</b>' : ''} su WhatsApp: il messaggio è già scritto.
      Le ore extra contano solo dopo l'autorizzazione.</p>
    <a class="btn big wa" href="${esc(url)}" target="_blank" rel="noopener">Invia su WhatsApp</a>
    <button class="btn ghost" value="">Fatto</button>`);
}

// ---------- Ferie, permessi, malattia (dipendente) ----------
const TIPI_ASSENZA = ['Ferie', 'Permesso', 'Malattia'];
const fmtDay = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const statoClass = st => st === 'Approvata' ? 'ok' : st === 'Rifiutata' ? 'no' : 'wait';
function absLine(a) {
  const quando = a.tipo === 'Permesso' ? `${fmtDay(a.dal)} · ${String(a.ore).replace('.', ',')} ore`
    : `${fmtDay(a.dal)}${a.al && a.al !== a.dal ? ' → ' + fmtDay(a.al) : ''}`;
  return `<b>${esc(a.tipo)}</b> · ${quando}`;
}
async function myAbsences() {
  db.assenze = db.assenze || [];
  busy('Carico le tue richieste');
  let server = [];
  try {
    const res = await withTimeout(fetch(ep(`azione=assenze&device=${encodeURIComponent(db.user.device)}`)), 20000);
    const out = await res.json();
    if (out.ok) server = out.assenze;
  } catch (e) { /* offline: si mostrano quelle salvate sul telefono */ }
  const byId = new Map(server.map(a => [a.id, a]));
  const list = db.assenze.map(a => Object.assign({}, a, byId.get(a.id) || { stato: 'Da inviare' }))
    .concat(server.filter(a => !db.assenze.some(x => x.id === a.id)))
    .sort((x, y) => (x.dal < y.dal ? 1 : -1));
  openDialog(`
    <h3>🌴 Ferie, permessi, malattia</h3>
    <button class="btn" value="new">+ Nuova richiesta</button>
    <div class="adm-list">${list.length ? list.map(a => `
      <div class="extra-card">${absLine(a)} <span class="pill ${statoClass(a.stato)}">${esc(a.stato || 'Da approvare')}</span>
        ${a.nota ? `<br><span>${esc(a.nota)}</span>` : ''}</div>`).join('') : '<p>Nessuna richiesta.</p>'}</div>
    <button class="btn ghost" value="">Chiudi</button>`, a => { if (a === 'new') setTimeout(newAbsence, 50); });
}
function newAbsence(msg, prev) {
  const v = prev || { tipo: 'Ferie', dal: todayIso(), al: todayIso(), ore: 2, nota: '' };
  openDialog(`
    <h3>Nuova richiesta</h3>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <div class="motivi">${TIPI_ASSENZA.map(t => `<label><input type="radio" name="tipo" value="${t}" ${v.tipo === t ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <div class="row">
      <label>Dal<input type="date" name="dal" value="${esc(v.dal)}" required></label>
      <label id="lblAl">Al<input type="date" name="al" value="${esc(v.al)}"></label>
      <label id="lblOre" hidden>Ore<input type="number" name="ore" min="0.5" max="8" step="0.5" value="${esc(v.ore)}"></label>
    </div>
    <p class="note">Ferie e malattia contano i giorni dal lunedì al venerdì.</p>
    <label>Nota<textarea name="nota" rows="2" maxlength="300" placeholder="Es. visita medica, n. certificato…">${esc(v.nota)}</textarea></label>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="ok">Invia richiesta</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(myAbsences, 50);
      const x = { id: uid(), tipo: String(fd.get('tipo')), dal: String(fd.get('dal')), al: String(fd.get('al') || fd.get('dal')),
        ore: Number(fd.get('ore')) || 0, nota: String(fd.get('nota') || '').trim() };
      if (x.tipo === 'Permesso') x.al = x.dal;
      if (x.al < x.dal) return setTimeout(() => newAbsence('La data "Al" deve essere uguale o dopo "Dal".', x), 50);
      if (x.tipo === 'Permesso' && !(x.ore > 0)) return setTimeout(() => newAbsence('Indica quante ore di permesso.', x), 50);
      db.assenze = (db.assenze || []).concat(x);
      enqueue({ type: 'assenza', assenza: x });
      save();
      setTimeout(() => askAbsenceAuth(x), 50);
    });
  const sync = () => {
    const perm = document.querySelector('#dlgBody [name=tipo]:checked').value === 'Permesso';
    $('#lblAl').hidden = perm; $('#lblOre').hidden = !perm;
  };
  document.querySelectorAll('#dlgBody [name=tipo]').forEach(r => { r.onchange = sync; });
  sync();
}
function askAbsenceAuth(x) {
  const c = cfg();
  const quando = x.tipo === 'Permesso' ? `${new Date(x.dal + 'T12:00:00').toLocaleDateString('it-IT')} – ${x.ore} ore`
    : `dal ${new Date(x.dal + 'T12:00:00').toLocaleDateString('it-IT')} al ${new Date(x.al + 'T12:00:00').toLocaleDateString('it-IT')}`;
  const text = [`*Richiesta ${x.tipo.toLowerCase()}*`, `Dipendente: ${fullName()}`, `Quando: ${quando}`, x.nota ? `Nota: ${x.nota}` : ''].filter(Boolean).join('\n');
  const url = `https://wa.me/${c.autorizzaTelefono || ''}?text=${encodeURIComponent(text)}`;
  openDialog(`
    <h3>📲 Avvisa il responsabile</h3>
    <p>Richiesta registrata. Manda il messaggio${c.autorizzaNome ? ' a <b>' + esc(c.autorizzaNome) + '</b>' : ''} su WhatsApp: è già scritto.</p>
    <a class="btn big wa" href="${esc(url)}" target="_blank" rel="noopener">Invia su WhatsApp</a>
    <button class="btn ghost" value="">Fatto</button>`);
}

// ---------- Pannello responsabile (password verificata dallo script) ----------
let adminPwd = null; // solo in memoria: chiusa l'app, la password va reinserita
let adminMonth = null; // 'AAAA-MM' scelto nel pannello
let adminExtraCount = 0, adminAbsCount = 0;
async function adminCall(azione, extra) {
  const res = await fetch(db.endpoint, { method: 'POST', body: JSON.stringify({ codice: db.codice || '', admin: Object.assign({ password: adminPwd, azione }, extra || {}) }) });
  return res.json();
}
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthParts = m => ({ anno: Number(m.slice(0, 4)), mese: Number(m.slice(5, 7)) - 1 });
const monthInput = () => `<label>Mese<input type="month" name="mese" value="${adminMonth || monthNow()}" required></label>`;
function busy(text) { openDialog(`<h3>${esc(text)}</h3><p>Un attimo…</p><button class="btn ghost" value="">Chiudi</button>`); }
// Una richiesta allo script che non risponde entro 30 secondi viene considerata fallita
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
function fail(msg) { openDialog(`<h3>Errore</h3><p>${esc(msg)}</p><button class="btn" value="back">Indietro</button>`, () => setTimeout(adminHome, 50)); }
function call(azione, extra, waitText, onOk) {
  busy(waitText);
  withTimeout(adminCall(azione, extra), 30000).then(out => {
    if (out.ok) onOk(out);
    else if (out.error === 'password' || out.error === 'bloccato') { adminPwd = null; setTimeout(() => adminLogin(out.msg), 50); }
    else fail(out.msg || 'Qualcosa non ha funzionato.');
  }).catch(e => fail(e && e.message === 'timeout'
    ? 'Il registro non ha risposto. Controlla la connessione e riprova.'
    : 'Serve la connessione internet.'));
}

function adminLogin(msg) {
  if (adminPwd) return adminHome();
  openDialog(`
    <h3>🔒 Area responsabile</h3>
    <p>${esc(msg || 'Inserisci la tua password.')}</p>
    <label>Password<input type="password" name="pwd" required autocomplete="current-password"></label>
    <div class="row"><button class="btn ghost" value="" formnovalidate>Annulla</button><button class="btn" value="ok">Entra</button></div>`,
    (a, fd) => {
      adminPwd = String(fd.get('pwd') || '');
      busy('Controllo password');
      adminCall('leggi').then(out => {
        if (out.ok) {
          adminExtraCount = out.extraInAttesa || 0; adminAbsCount = out.assenzeInAttesa || 0;
          if (out.codice && db.codice !== out.codice) { db.codice = out.codice; resyncAll(); save(); }
          adminHome();
        }
        else if (out.error === 'nopass') { adminPwd = null; adminCreatePassword(); }
        else { adminPwd = null; adminLogin(out.msg || 'Errore.'); }
      }).catch(() => { adminPwd = null; adminLogin('Serve la connessione internet.'); });
    });
}

function adminCreatePassword(msg) {
  openDialog(`
    <h3>🔒 Crea la tua password</h3>
    <p>${esc(msg || 'È la prima volta: scegli la password del responsabile (almeno 6 caratteri). Non dirla ai dipendenti.')}</p>
    <label>Nuova password<input type="password" name="p1" required minlength="6" autocomplete="new-password"></label>
    <label>Ripeti password<input type="password" name="p2" required minlength="6" autocomplete="new-password"></label>
    <div class="row"><button class="btn ghost" value="" formnovalidate>Annulla</button><button class="btn" value="ok">Crea</button></div>`,
    (a, fd) => {
      const p1 = String(fd.get('p1')), p2 = String(fd.get('p2'));
      if (p1 !== p2) { setTimeout(() => adminCreatePassword('Le due password non coincidono. Riprova.'), 50); return; }
      busy('Salvo la password');
      adminCall('imposta', { nuova: p1 }).then(out => {
        if (out.ok) { adminPwd = p1; adminHome(); toast('Password creata'); }
        else adminCreatePassword(out.msg);
      }).catch(() => fail('Serve la connessione internet.'));
    });
}

function adminInvite(codice) {
  if (!codice) return fail('Il codice di accesso non è ancora attivo: nello script esegui una volta "attivaCodiceAccesso".');
  if (db.codice !== codice) { db.codice = codice; save(); }
  const link = `${location.origin}${location.pathname}?codice=${codice}`;
  openDialog(`
    <h3>🔗 Link di invito</h3>
    <p>Mandalo a ogni operatore. Lo apre una volta sul suo telefono e da lì le timbrature vengono accettate. Chi non ha il link non può inviare né leggere niente.</p>
    <input readonly value="${esc(link)}" onclick="this.select()">
    <p class="note">Non pubblicarlo nei gruppi aperti. Se finisce in mani sbagliate si cambia rieseguendo "attivaCodiceAccesso" e mandando il link nuovo.</p>
    <div class="menu">
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent('Apri questo link sul telefono per collegare l\'app Timbra Cantieri: ' + link)}" target="_blank" rel="noopener">📤 Invia su WhatsApp</a>
      <button class="btn ghost" value="copy">Copia</button>
      <button class="btn ghost" value="back">Indietro</button>
    </div>`, a => {
    if (a === 'copy') navigator.clipboard.writeText(link).then(() => toast('Link copiato'), () => {});
    if (a === 'back') setTimeout(adminHome, 50);
  });
}
function adminHome() {
  if (!db.adminDevice) { db.adminDevice = true; save(); }
  openDialog(`
    <h3>🔒 Area responsabile</h3>
    <div class="menu">
      <button class="btn ghost" value="sites">🏗️ Cantieri: aggiungi, togli, rinomina</button>
      <button class="btn ghost" value="report">📊 Report del mese: PDF, stampa, email, condividi</button>
      <button class="btn ghost" value="int">📍 Interventi da assegnare</button>
      <button class="btn ghost" value="dpi">🦺 DPI e vestiario</button>
      <button class="btn ghost" value="plan">📅 Programma della settimana</button>
      <button class="btn ghost" value="stats">📈 Statistiche ore per cantiere</button>
      <button class="btn ghost" value="extra">⏱️ Ore extra da autorizzare${adminExtraCount ? ` <span class="badge">${adminExtraCount}</span>` : ''}</button>
      <button class="btn ghost" value="assenze">🌴 Ferie, permessi, malattia${adminAbsCount ? ` <span class="badge">${adminAbsCount}</span>` : ''}</button>
      <button class="btn ghost" value="shifts">✏️ Modifica timbrature dei dipendenti</button>
      <button class="btn ghost" value="invito">🔗 Link di invito per gli operatori</button>
      <button class="btn ghost" value="sede">📍 Sede per le timbrature</button>
      <button class="btn ghost" value="demo">${isDemo() ? '🧪 Disattiva la modalità prova' : '🧪 Modalità prova: timbra anche fuori sede'}</button>
      <button class="btn ghost" value="pwd">🔑 Cambia password</button>
      <button class="btn ghost danger-text" value="reset">🧹 Azzera tutto e parti da zero</button>
      <button class="btn ghost" value="logout">Esci dall'area responsabile</button>
      <button class="btn ghost" value="forget">Nascondi l'area responsabile su questo telefono</button>
      <button class="btn" value="">Chiudi</button>
    </div>`, a => {
    const go = {
      sites: () => call('leggi', null, 'Carico i cantieri', out => adminSites(out.cantieri)),
      report: adminReportPick,
      stats: adminStatsPick,
      plan: () => adminPlan(),
      int: adminInterventi,
      dpi: adminDpi,
      shifts: adminShiftsPick,
      extra: () => call('extra', null, 'Carico le richieste', out => adminExtra(out.extra)),
      assenze: () => call('assenze', null, 'Carico ferie e permessi', out => adminAbsences(out.assenze)),
      pwd: adminChangePassword,
      sede: () => adminSede(),
      invito: () => call('codice', null, 'Preparo il link', out => adminInvite(out.codice)),
      demo: () => { setDemo(!isDemo()); adminHome(); },
      reset: adminReset,
      logout: () => { adminPwd = null; toast('Uscito dall\'area responsabile'); },
      forget: () => { adminPwd = null; db.adminDevice = false; save(); toast('Per rientrare: 5 tocchi veloci sul logo'); },
    }[a];
    if (go) setTimeout(go, 50);
  });
}

// --- Cantieri
// Colori ben distinguibili tra loro, per riconoscere i comuni a colpo d'occhio
const SITE_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#0d9488',
  '#0891b2', '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#78716c', '#1f2937'];
function adminSites(list) {
  const localColor = nome => (db.sites.find(s => s.name === nome) || {}).color;
  const row = (c, i) => {
    const col = c.colore || localColor(c.nome) || SITE_COLORS[i % SITE_COLORS.length];
    return `<div class="adm-site">
      <div class="adm-row">
        <button type="button" class="swatch" data-sw="${i}" style="background:${esc(col)}" aria-label="Scegli colore"></button>
        <input type="hidden" name="c${i}" value="${esc(col)}">
        <input name="n${i}" value="${esc(c.nome)}" maxlength="60" placeholder="Nome cantiere">
        <label class="adm-on"><input type="checkbox" name="a${i}" ${c.attivo ? 'checked' : ''}> Attivo</label>
      </div>
      <div class="palette" id="pal${i}" hidden>${SITE_COLORS.map(x => `<button type="button" data-pick="${i}" data-col="${x}" style="background:${x}" aria-label="${x}"></button>`).join('')}</div>
    </div>`;
  };
  openDialog(`
    <h3>🏗️ Cantieri</h3>
    <p>Tocca il pallino per cambiare colore. Togli la spunta per nascondere un cantiere: le timbrature fatte restano. Per eliminarlo svuota il nome.</p>
    <div class="adm-list" id="admList">${list.map(row).join('')}</div>
    <button type="button" class="btn ghost" id="admAdd">+ Aggiungi cantiere</button>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="save">Salva</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      const n = $('#admList').children.length;
      const cantieri = [];
      for (let i = 0; i < n; i++) {
        const nome = String(fd.get('n' + i) || '').trim();
        if (nome) cantieri.push({ nome, attivo: fd.get('a' + i) === 'on', colore: String(fd.get('c' + i) || '') });
      }
      setTimeout(() => call('salva', { cantieri }, 'Salvo i cantieri', out => {
        const back = new Map((out.cantieri || []).map(c => [c.nome, c.colore]));
        const ok = cantieri.every(c => back.get(c.nome.toUpperCase()) === c.colore.toLowerCase());
        syncSites();
        openDialog(ok ? `
          <h3>✓ Cantieri salvati</h3>
          <p>${cantieri.length} cantieri con i loro colori. Arrivano su tutti i telefoni alla prossima apertura dell'app.</p>
          <div class="row"><button class="btn ghost" value="admin">Area responsabile</button><button class="btn" value="">Torna all'app</button></div>`
          : `<h3>Attenzione</h3><p>I cantieri sono stati salvati ma i colori no. Probabilmente lo script Google è una versione vecchia: avvisa chi lo gestisce.</p>
          <button class="btn" value="">OK</button>`, a => { if (a === 'admin') setTimeout(adminHome, 50); });
      }), 50);
    });
  // Un solo listener per la lista: apre la tavolozza e applica il colore scelto
  $('#admList').onclick = e => {
    const sw = e.target.closest('[data-sw]');
    if (sw) {
      document.querySelectorAll('.palette').forEach(p => { if (p.id !== 'pal' + sw.dataset.sw) p.hidden = true; });
      const pal = $('#pal' + sw.dataset.sw); pal.hidden = !pal.hidden; return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const i = pk.dataset.pick;
      document.querySelector(`[name="c${i}"]`).value = pk.dataset.col;
      document.querySelector(`[data-sw="${i}"]`).style.background = pk.dataset.col;
      $('#pal' + i).hidden = true;
    }
  };
  $('#admAdd').onclick = () => {
    const i = $('#admList').children.length;
    $('#admList').insertAdjacentHTML('beforeend', row({ nome: '', attivo: true }, i));
    $('#admList').lastElementChild.querySelector('input[name^="n"]').focus();
  };
}

// --- Report
function adminReportPick() {
  openDialog(`
    <h3>📊 Report del mese</h3>
    ${monthInput()}
    <div class="motivi">
      <label><input type="radio" name="tipo" value="dipendenti" ${adminReportType !== 'comuni' ? 'checked' : ''}> Per dipendente</label>
      <label><input type="radio" name="tipo" value="comuni" ${adminReportType === 'comuni' ? 'checked' : ''}> Per comune</label>
    </div>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="ok">Mostra</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      adminMonth = String(fd.get('mese'));
      adminReportType = String(fd.get('tipo') || 'dipendenti');
      setTimeout(() => call('report', Object.assign(monthParts(adminMonth), { tipo: adminReportType }), 'Preparo il report', adminReport), 50);
    });
}
const num = v => typeof v === 'number' ? String(v).replace('.', ',') : esc(v);
function reportTable(r) {
  return `<table class="rep"><thead><tr>${r.intest.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${r.righe.map(row => `<tr>${row.map(v => `<td>${num(v)}</td>`).join('')}</tr>`).join('')}
    <tr class="tot">${r.totale.map(v => `<td>${num(v)}</td>`).join('')}</tr></tbody></table>`;
}
let lastReport = null, adminReportType = 'dipendenti';
function adminReport(r) {
  lastReport = r;
  openDialog(`
    <h3>${adminReportType === 'comuni' ? 'Servizi per comune' : 'Ore del personale'} – ${esc(r.nomeMese)}</h3>
    ${r.righe.length ? `<div class="rep-wrap">${reportTable(r)}</div>` : '<p>Nessuna timbratura in questo mese.</p>'}
    <div class="menu">
      <button class="btn" value="pdf">📄 Scarica / condividi PDF</button>
      <button class="btn ghost" value="print">🖨️ Stampa</button>
      <button class="btn ghost" value="email">📧 Invia per email (dipendenti + comuni)</button>
      <button class="btn ghost" value="back">Indietro</button>
    </div>`, a => {
    const p = Object.assign(monthParts(adminMonth), { tipo: adminReportType });
    if (a === 'back') setTimeout(adminHome, 50);
    if (a === 'print') setTimeout(() => printReport(r), 50);
    if (a === 'email') setTimeout(() => call('email', p, 'Invio l\'email', () => { toast('Email inviata ✓'); adminReport(r); }), 50);
    if (a === 'pdf') setTimeout(() => call('pdf', p, 'Creo il PDF', out => { sharePdf(out); adminReport(r); }), 50);
  });
}
async function sharePdf(out) {
  const bytes = Uint8Array.from(atob(out.base64), c => c.charCodeAt(0));
  const file = new File([bytes], out.nome, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: out.nome }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = out.nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function printReport(r) {
  $('#printArea').innerHTML = `<img src="logo.png" alt="GE3CO" class="print-logo">
    <h1>${adminReportType === 'comuni' ? 'Servizi per comune' : 'Ore del personale'} – ${esc(r.nomeMese)}</h1>${reportTable(r)}
    <p class="print-foot">Stampato il ${new Date().toLocaleDateString('it-IT')}</p>`;
  if (dlg.open) dlg.close();
  setTimeout(() => { window.print(); setTimeout(() => adminReport(r), 300); }, 100);
}

// --- Ore extra
function adminExtra(list) {
  adminExtraCount = list.length;
  const h = n => fmtDur(n * 3600000);
  openDialog(`
    <h3>⏱️ Ore extra da autorizzare</h3>
    ${list.length ? `<div class="adm-list">${list.map(x => `
      <div class="extra-card">
        <b>${esc(x.dip)}</b> · ${esc(x.cantiere)}<br>
        <span>${x.start ? fmtDate(x.start) + ' · ' + fmtTime(x.start) : ''} → ${x.end ? fmtTime(x.end) : ''} · <b>+${h(x.extra)} extra</b></span><br>
        <span>Motivo: ${esc(x.motivo || '—')}${x.nota ? ' – ' + esc(x.nota) : ''}</span>
        <div class="row">
          <button type="button" class="btn ghost" data-dec="no" data-id="${esc(x.id)}">Rifiuta</button>
          <button type="button" class="btn" data-dec="ok" data-id="${esc(x.id)}">Autorizza</button>
        </div>
      </div>`).join('')}</div>` : '<p>Nessuna richiesta in attesa. 👍</p>'}
    <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(adminHome, 50));
  document.querySelectorAll('[data-dec]').forEach(b => {
    b.onclick = () => call('decidi', { id: b.dataset.id, approva: b.dataset.dec === 'ok' }, 'Salvo',
      out => { toast(b.dataset.dec === 'ok' ? 'Ore extra autorizzate ✓' : 'Ore extra non autorizzate'); adminExtra(out.extra); });
  });
}

// --- Ferie e permessi
function adminAbsences(list) {
  const pending = list.filter(a => a.stato === 'Da approvare');
  const others = list.filter(a => a.stato !== 'Da approvare').slice(0, 40);
  adminAbsCount = pending.length;
  const card = (a, buttons) => `<div class="extra-card"><b>${esc(a.dip)}</b> · ${absLine(a)}
      ${a.tipo !== 'Permesso' && a.giorni ? ` · ${a.giorni} giorn${a.giorni === 1 ? 'o' : 'i'}` : ''}
      ${buttons ? '' : ` <span class="pill ${statoClass(a.stato)}">${esc(a.stato)}</span>`}
      ${a.nota ? `<br><span>${esc(a.nota)}</span>` : ''}
      ${buttons ? `<div class="row"><button type="button" class="btn ghost" data-ass="no" data-id="${esc(a.id)}">Rifiuta</button>
        <button type="button" class="btn" data-ass="ok" data-id="${esc(a.id)}">Approva</button></div>` : ''}</div>`;
  openDialog(`
    <h3>🌴 Ferie, permessi, malattia</h3>
    <p><b>Da approvare</b></p>
    <div class="adm-list">${pending.length ? pending.map(a => card(a, true)).join('') : '<p>Nessuna richiesta in attesa. 👍</p>'}</div>
    ${others.length ? `<p><b>Già decise</b></p><div class="adm-list">${others.map(a => card(a, false)).join('')}</div>` : ''}
    <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(adminHome, 50));
  document.querySelectorAll('[data-ass]').forEach(b => {
    b.onclick = () => call('decidiassenza', { id: b.dataset.id, approva: b.dataset.ass === 'ok' }, 'Salvo',
      out => { toast(b.dataset.ass === 'ok' ? 'Richiesta approvata ✓' : 'Richiesta rifiutata'); adminAbsences(out.assenze); });
  });
}

// --- Timbrature
let adminShifts = null, adminSitesList = [];
// ---------- Statistiche ore per cantiere (area responsabile) ----------
// Ore contate come nel riepilogo: ogni turno chiuso vale oreTurno ore fisse + gli extra autorizzati.
let statsShifts = [], statsSites = [];
function adminStatsPick() {
  openDialog(`
    <h3>📈 Statistiche per cantiere</h3>
    ${monthInput()}
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="ok">Mostra</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      adminMonth = String(fd.get('mese'));
      setTimeout(() => call('timbrature', monthParts(adminMonth), 'Carico le timbrature', out => {
        statsShifts = out.timbrature || []; statsSites = out.cantieri || []; adminStats('');
      }), 50);
    });
}
function statsFor(filter) {
  const ore = cfg().oreTurno;
  const by = {};
  statsShifts.filter(t => (!filter || t.dip === filter) && t.end && !/^PROVA/.test(t.sede || '')).forEach(t => {
    const k = t.cantiere || '—';
    const x = by[k] || (by[k] = { nome: k, turni: 0, ore: 0, extra: 0, operatori: new Set() });
    x.turni++;
    x.ore += ore;
    if (t.extra && t.statoExtra === 'Autorizzato') { x.ore += t.extra; x.extra += t.extra; }
    x.operatori.add(t.dip);
  });
  return Object.values(by).sort((a, b) => b.ore - a.ore || a.nome.localeCompare(b.nome));
}
function adminStats(filter) {
  const people = [...new Set(statsShifts.map(t => t.dip))].sort();
  const rows = statsFor(filter);
  const tot = rows.reduce((s, r) => ({ turni: s.turni + r.turni, ore: s.ore + r.ore, extra: s.extra + r.extra }), { turni: 0, ore: 0, extra: 0 });
  const max = Math.max(1, ...rows.map(r => r.ore));
  const color = n => (statsSites.find(c => c.nome === n) || {}).colore || 'var(--brand)';
  const h = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const [y, m] = adminMonth.split('-');
  const meseLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const aperti = statsShifts.filter(t => (!filter || t.dip === filter) && !t.end).length;
  openDialog(`
    <h3>📈 Ore per cantiere</h3>
    <p class="note">${esc(meseLabel)} · ogni turno vale ${cfg().oreTurno} ore + extra autorizzati</p>
    <label>Operatore<select id="statWho"><option value="">Tutti gli operatori</option>${people.map(p => `<option ${p === filter ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <div class="stat-tot">
      <div><strong>${h(tot.ore)}</strong><span>ore totali</span></div>
      <div><strong>${tot.turni}</strong><span>turni</span></div>
      <div><strong>${rows.length}</strong><span>cantieri</span></div>
    </div>
    ${rows.length ? `<div class="stat-bars" role="img" aria-label="Ore per cantiere">${rows.map(r => `
      <div class="stat-row">
        <div class="stat-head"><span class="dot" style="background:${esc(color(r.nome))}"></span><b>${esc(r.nome)}</b><span class="stat-val">${h(r.ore)} h</span></div>
        <div class="stat-track"><span style="width:${(r.ore / max * 100).toFixed(1)}%;background:${esc(color(r.nome))}"></span></div>
        <div class="stat-sub">${r.turni} turn${r.turni === 1 ? 'o' : 'i'}${r.extra ? ` · +${h(r.extra)} h extra` : ''}${filter ? '' : ` · ${r.operatori.size} operator${r.operatori.size === 1 ? 'e' : 'i'}`} · ${Math.round(r.ore / (tot.ore || 1) * 100)}%</div>
      </div>`).join('')}</div>` : '<p>Nessun turno chiuso in questo mese.</p>'}
    ${aperti ? `<p class="note">${aperti} turn${aperti === 1 ? 'o' : 'i'} senza uscita non conteggiat${aperti === 1 ? 'o' : 'i'}.</p>` : ''}
    <div class="row"><button class="btn ghost" value="month">Cambia mese</button><button class="btn" value="back">Indietro</button></div>`,
    a => setTimeout(a === 'month' ? adminStatsPick : adminHome, 50));
  $('#statWho').onchange = e => adminStats(e.target.value);
}

function adminShiftsPick() {
  openDialog(`
    <h3>✏️ Timbrature dei dipendenti</h3>
    ${monthInput()}
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="ok">Mostra</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      adminMonth = String(fd.get('mese'));
      setTimeout(loadShifts, 50);
    });
}
function loadShifts(filter) {
  call('timbrature', monthParts(adminMonth), 'Carico le timbrature', out => {
    adminShifts = out.timbrature; adminSitesList = out.cantieri; adminShiftList(filter || '');
  });
}
function adminShiftList(filter) {
  const people = [...new Set(adminShifts.map(t => t.dip))].sort();
  const list = adminShifts.filter(t => !filter || t.dip === filter);
  openDialog(`
    <h3>✏️ Timbrature</h3>
    <label>Dipendente<select id="admWho"><option value="">Tutti</option>${people.map(p => `<option ${p === filter ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <div class="adm-list">${list.length ? list.map(t => `
      <button type="button" class="shift-row" data-sid="${esc(t.id)}">
        <b>${esc(t.dip)}</b> · ${esc(t.cantiere)} · ${esc(t.turno || '')}<br>
        <span>${fmtDate(t.start)} · ${fmtTime(t.start)} → ${t.end ? fmtTime(t.end) + ' · ' + fmtDur(t.end - t.start) : '<em>in corso</em>'}${t.extra ? ` · <b>+${fmtDur(t.extra * 3600000)} extra</b> (${esc(t.statoExtra || '')})` : ''}</span>
      </button>`).join('') : '<p>Nessuna timbratura.</p>'}</div>
    <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(adminHome, 50));
  $('#admWho').onchange = e => adminShiftList(e.target.value);
  document.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => adminShiftEdit(b.dataset.sid, filter); });
}
function posLinks(t) {
  const one = (label, v) => !v ? '' : /^https:/.test(v)
    ? `<a class="btn ghost" href="${esc(v.split(' ')[0])}" target="_blank" rel="noopener">📍 ${label} sulla mappa${v.includes('±') ? ' ' + esc(v.slice(v.indexOf('('))) : ''}</a>`
    : `<p class="note">📍 ${label}: ${esc(v)}</p>`;
  return one('Entrata', t.posIn) + one('Uscita', t.posOut);
}
function adminShiftEdit(id, filter) {
  const t = adminShifts.find(x => x.id === id);
  const names = adminSitesList.map(c => c.nome);
  if (!names.includes(t.cantiere)) names.unshift(t.cantiere);
  openDialog(`
    <h3>${esc(t.dip)}</h3>
    <label>Cantiere<select name="site">${names.map(n => `<option ${n === t.cantiere ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label>Entrata<input type="datetime-local" name="start" required value="${toLocalInput(t.start)}"></label>
    <label>Uscita<input type="datetime-local" name="end" value="${t.end ? toLocalInput(t.end) : ''}"></label>
    ${posLinks(t)}
    <div class="row">
      <button class="btn ghost" value="delete" formnovalidate style="color:var(--danger)">Elimina</button>
      <button class="btn ghost" value="back" formnovalidate>Indietro</button>
      <button class="btn" value="save">Salva</button>
    </div>`, (a, fd) => {
    if (a === 'back') return setTimeout(() => adminShiftList(filter), 50);
    if (a === 'delete') {
      if (!confirm(`Eliminare la timbratura di ${t.dip}?`)) return false;
      return setTimeout(() => call('elimina', { id }, 'Elimino', () => { toast('Timbratura eliminata'); loadShifts(filter); }), 50);
    }
    const start = new Date(fd.get('start')).getTime();
    const endVal = fd.get('end');
    const end = endVal ? new Date(endVal).getTime() : null;
    if (end !== null && !(end > start)) { alert("L'uscita deve essere dopo l'entrata."); return false; }
    setTimeout(() => call('modifica', { t: { id, start, end, cantiere: fd.get('site') } }, 'Salvo', () => {
      toast('Timbratura modificata ✓'); loadShifts(filter);
    }), 50);
  });
}

// --- Sede
function adminSede(msg) {
  const sede = cfg().sede || {};
  const map = isFinite(sede.lat) ? `https://maps.google.com/?q=${sede.lat},${sede.lng}` : '';
  openDialog(`
    <h3>📍 Sede per le timbrature</h3>
    <p>Entrata e uscita si timbrano solo entro <b>${sede.raggio || '?'} m</b> da questo punto.</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    ${map ? `<a class="btn ghost" href="${esc(map)}" target="_blank" rel="noopener">Vedi la sede sulla mappa</a>` : ''}
    <label>Raggio<select name="raggio">${[100, 150, 200, 300, 500].map(r => `<option value="${r}" ${r === sede.raggio ? 'selected' : ''}>${r} metri</option>`).join('')}</select></label>
    <p class="note">Per centrare la sede con precisione, premi il pulsante qui sotto mentre sei in ufficio.</p>
    <button class="btn" value="here">📍 Usa la mia posizione attuale come sede</button>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn ghost" value="raggio">Salva solo il raggio</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      const raggio = Number(fd.get('raggio'));
      const save = (lat, lng) => call('sede', { sede: { lat, lng, raggio } }, 'Salvo la sede', out => {
        db.config = Object.assign({}, db.config, { sede: out.sede }); save_();
        toast('Sede salvata ✓'); adminSede();
      });
      if (a === 'raggio') return setTimeout(() => save(sede.lat, sede.lng), 50);
      if (a === 'here') {
        setTimeout(async () => {
          busy('Rilevo la tua posizione');
          const pos = await getPos();
          if (pos.errore) return adminSede('Posizione non disponibile: ' + pos.errore);
          if (pos.acc > 100) return adminSede(`Segnale GPS poco preciso (±${Math.round(pos.acc)} m). Avvicinati a una finestra o esci e riprova.`);
          save(pos.lat, pos.lng);
        }, 50);
      }
    });
}
const save_ = () => save();

// --- Azzeramento
function adminReset(msg) {
  openDialog(`
    <h3>🧹 Azzera tutto</h3>
    <p>Tutte le timbrature fatte finora (prove comprese) spariscono dall'app, dai telefoni e dai report.
      Nel Google Sheet non si perdono: vengono spostate nel foglio nascosto "Archivio prove".</p>
    <p>Restano: cantieri, password, nomi dei dipendenti.</p>
    ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <label>Per confermare scrivi AZZERA<input name="conf" autocomplete="off" autocapitalize="characters"></label>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn danger" value="ok">Azzera</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      if (String(fd.get('conf') || '').trim().toUpperCase() !== 'AZZERA') return setTimeout(() => adminReset('Scrivi AZZERA per confermare.'), 50);
      setTimeout(() => call('azzera', null, 'Azzero il registro', () => {
        adminExtraCount = 0;
        syncSites().then(() => { toast('Registro azzerato: si parte da zero ✓'); adminHome(); });
      }), 50);
    });
}

// --- Password
function adminChangePassword(msg) {
  openDialog(`
    <h3>🔑 Cambia password</h3>
    ${msg ? `<p>${esc(msg)}</p>` : ''}
    <label>Nuova password<input type="password" name="p1" required minlength="6" autocomplete="new-password"></label>
    <label>Ripeti password<input type="password" name="p2" required minlength="6" autocomplete="new-password"></label>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="ok">Salva</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      const p1 = String(fd.get('p1')), p2 = String(fd.get('p2'));
      if (p1 !== p2) return setTimeout(() => adminChangePassword('Le due password non coincidono.'), 50);
      setTimeout(() => call('cambiapassword', { nuova: p1 }, 'Salvo la password', () => {
        adminPwd = p1; toast('Password cambiata ✓'); adminHome();
      }), 50);
    });
}

// Link di collegamento che il responsabile manda ai dipendenti: ...?collega=<URL web app>
function handleConnect() {
  const params = new URLSearchParams(location.search);
  const codice = params.get('codice');
  if (codice && /^[A-Za-z0-9]{6,40}$/.test(codice)) {
    db.codice = codice;
    if (db.user) resyncAll();
    save();
    if (!params.get('collega')) {
      history.replaceState(null, '', location.pathname);
      syncSites();
      toast('Telefono abilitato al registro aziendale ✓');
      return false;
    }
  }
  const url = params.get('collega');
  if (!url) return false;
  history.replaceState(null, '', location.pathname);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    alert('Link di collegamento non valido.');
    return false;
  }
  openDialog(`
    <h3>Collegare al registro aziendale?</h3>
    <p>Le tue timbrature verranno inviate automaticamente al foglio del responsabile.</p>
    <div class="row"><button class="btn ghost" value="">No</button><button class="btn" value="ok">Collega</button></div>`,
    () => {
      db.endpoint = url;
      if (db.user) resyncAll();
      save();
      syncSites();
      toast('Collegato al registro aziendale ✓');
    });
  return true;
}

// ---------- Avvio ----------
render();
const afterProfile = () => { if (!handleConnect()) handleNfc(); };
if (db.user) afterProfile(); else editProfile(afterProfile);
window.addEventListener('online', () => { flush(); syncSites(); syncPlan(); syncInterventi(); });
syncSites();
syncPlan();
syncInterventi();
setInterval(flush, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { db = load(); db.queue = db.queue || []; db.endpoint = db.endpoint || DEFAULT_ENDPOINT; render(); flush(); syncSites(); syncPlan(); syncInterventi(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
