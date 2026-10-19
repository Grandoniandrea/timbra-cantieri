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
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwrPn7c9W0Dl9mUZGq6Yp35uhv2wprrhOUFFB4PF50ZYtIhY2o1bVugEYrmIJh3NJf6xw/exec';
let db = load();
db.queue = db.queue || [];
db.endpoint = db.endpoint || DEFAULT_ENDPOINT;
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
function clockIn(siteId) {
  if (db.active) return;
  db.active = { id: uid(), siteId, start: Date.now() };
  enqueueUpsert({ id: db.active.id, siteId, start: db.active.start, end: null });
  save();
  return db.active;
}
function clockOut() {
  if (!db.active) return null;
  const shift = { id: db.active.id || uid(), siteId: db.active.siteId, start: db.active.start, end: Date.now() };
  const prevActive = db.active;
  db.shifts.unshift(shift);
  db.active = null;
  enqueueUpsert(shift);
  save();
  shift.undo = () => {
    db.shifts = db.shifts.filter(s => s.id !== shift.id);
    db.active = prevActive;
    enqueueUpsert({ id: shift.id, siteId: shift.siteId, start: shift.start, end: null });
    save();
  };
  toast(`Uscita ${siteById(shift.siteId).name} · ${fmtDur(shift.end - shift.start)}`, shift.undo);
  return shift;
}

// ---------- Render ----------
let timer;
function render() {
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
      <p>Entrata alle ${fmtTime(db.active.start)} · ${fmtDate(db.active.start)}</p>
      <button class="btn big danger" id="btnOut">Timbra uscita</button>`;
    const tick = () => { const el = $('#timer'); if (el) el.textContent = fmtClock(Date.now() - db.active.start); };
    tick(); timer = setInterval(tick, 1000);
    $('#btnOut').onclick = () => clockOut();
  } else {
    st.className = 'card status';
    st.innerHTML = `
      <small>PRONTO A TIMBRARE</small>
      <h2>Nessun turno attivo</h2>
      <p>Tocca <b>Entrata</b> su un cantiere, oppure passa il telefono sul tag NFC.</p>`;
  }

  // Statistiche (turni chiusi + turno in corso)
  const all = db.shifts.slice();
  if (db.active) all.push({ start: db.active.start, end: Date.now() });
  const sum = from => all.filter(s => s.start >= from).reduce((a, s) => a + (s.end - s.start), 0);
  $('#statWeek').textContent = fmtDur(sum(startOfWeek()));
  $('#statMonth').textContent = fmtDur(sum(startOfMonth()));
  const n = db.shifts.filter(s => s.start >= startOfMonth()).length;
  $('#statMonthN').textContent = `${n} turn${n === 1 ? 'o' : 'i'} conclus${n === 1 ? 'o' : 'i'}`;

  // Cantieri
  const managed = !!db.endpoint;
  $('#btnAddSite').hidden = managed;
  $('#sitesNote').hidden = !managed;
  $('#foot').textContent = managed
    ? 'Le timbrature vengono inviate al registro aziendale.'
    : 'I dati restano su questo telefono. Fai un backup ogni tanto dal menu ⋯';
  const shown = db.sites.filter(s => !s.hidden);
  $('#sites').innerHTML = shown.length ? shown.map(s => {
    const here = db.active && db.active.siteId === s.id;
    return `<li>
      <span class="dot" style="background:${esc(s.color)}"></span>
      <div class="grow"><b>${esc(s.name)}</b><span>${here ? 'In corso' : 'Pronto'}</span></div>
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
      <div class="grow"><b>${esc(site.name)}</b><span>${fmtDate(s.start)} · ${fmtTime(s.start)} → ${fmtTime(s.end)}</span></div>
      <span class="log-dur">${fmtDur(s.end - s.start)}</span>
    </li>`;
  }).join('') : '<li class="empty">Le tue timbrature compariranno qui.</li>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-in],[data-edit-site],[data-edit-shift]');
  if (!t) return;
  if (t.dataset.in) { clockIn(t.dataset.in); toast(`Entrata ${siteById(t.dataset.in).name} alle ${fmtTime(Date.now())}`); }
  else if (t.dataset.editSite) editSite(t.dataset.editSite);
  else if (t.dataset.editShift) editShift(t.dataset.editShift);
});

// ---------- Dialog ----------
const dlg = $('#dlg');
function openDialog(html, onSubmit) {
  $('#dlgBody').innerHTML = html;
  dlg.onclose = null;
  dlg.oncancel = null;
  $('#dlgBody').onsubmit = e => {
    const btn = e.submitter;
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

function pickSiteForNfc() {
  openDialog(`
    <h3>Dove sei oggi?</h3>
    <p>Scegli il cantiere per timbrare l'entrata.</p>
    <div class="pick">${db.sites.filter(s => !s.hidden).map(s => `<button value="${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</button>`).join('')}</div>
    <button class="btn ghost" value="">Annulla</button>`, siteId => {
    clockIn(siteId);
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
  if (!db.active) { pickSiteForNfc(); return; }
  const doOut = () => {
    const shift = clockOut();
    if (shift) showBigOk('Uscita', siteById(shift.siteId).name,
      `${fmtTime(shift.start)} → ${fmtTime(shift.end)} · ${fmtDur(shift.end - shift.start)}`, shift.undo);
  };
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
  const rows = [['Dipendente', 'Data', 'Cantiere', 'Entrata', 'Uscita', 'Minuti', 'Ore']];
  db.shifts.filter(s => s.start >= from).sort((a, b) => a.start - b.start).forEach(s => {
    const min = Math.round((s.end - s.start) / 60000);
    rows.push([fullName(), new Date(s.start).toLocaleDateString('it-IT'), siteById(s.siteId).name, fmtTime(s.start), fmtTime(s.end), min, (min / 60).toFixed(2).replace('.', ',')]);
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
    <button class="btn ghost" value="csv">⬇︎ Scarica le mie timbrature (Excel)</button>
    <button class="btn ghost" value="">Chiudi</button>
  </div>` : `
  <h3>Menu</h3>
  <p>${esc(syncStatus())}</p>
  <div class="menu">
    ${db.endpoint ? '<button class="btn" value="admin">🔒 Area responsabile</button>' : ''}
    <button class="btn ghost" value="share">📤 Invia timbrature del mese</button>
    <button class="btn ghost" value="csv">⬇︎ Esporta tutte le timbrature (Excel)</button>
    <button class="btn ghost" value="profile">👤 Cambia nome e cognome</button>
    <button class="btn ghost" value="backup">💾 Salva backup completo</button>
    <button class="btn ghost" value="restore">♻︎ Ripristina da backup</button>
    <button class="btn ghost" value="nfc">🏷️ Link da scrivere sul tag NFC</button>
    <button class="btn ghost" value="">Chiudi</button>
  </div>`, action => {
  if (action === 'share') shareMonth();
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
}
$('#btnWho').onclick = () => editProfile();

// ---------- Registro aziendale (Google Sheet) ----------
// Ogni modifica va in coda e viene inviata appena c'è rete: funziona anche senza campo.
function enqueue(op) {
  op.opId = uid();
  // Per la stessa timbratura conta solo l'ultima operazione.
  const key = op.shift ? op.shift.id : op.id;
  db.queue = db.queue.filter(o => (o.shift ? o.shift.id : o.id) !== key);
  db.queue.push(op);
}
function enqueueUpsert(s) {
  enqueue({ type: 'upsert', shift: { id: s.id, start: s.start, end: s.end || null, site: siteById(s.siteId).name } });
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
      body: JSON.stringify({ user: { name: fullName(), device: db.user.device }, ops }),
    });
    const out = await res.json();
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
    const res = await fetch(db.endpoint + '?azione=cantieri');
    const out = await res.json();
    if (!out.ok || !Array.isArray(out.cantieri)) return;
    const names = out.cantieri;
    const byName = new Map(db.sites.map(s => [s.name, s]));
    const visible = names.map((name, i) => {
      const old = byName.get(name);
      return { id: old ? old.id : uid() + i, name, color: old ? old.color : COLORS[i % COLORS.length] };
    });
    // Quelli tolti dal foglio restano nascosti per i nomi nel registro.
    const hidden = db.sites.filter(s => !names.includes(s.name)).map(s => Object.assign({}, s, { hidden: true }));
    const next = visible.concat(hidden.filter(h => !visible.some(v => v.id === h.id)));
    if (JSON.stringify(next) !== JSON.stringify(db.sites)) { db.sites = next; save(); }
  } catch (e) { /* offline: si tengono i cantieri già scaricati */ }
}

// ---------- Pannello responsabile (password verificata dallo script) ----------
let adminPwd = null; // solo in memoria: chiusa l'app, la password va reinserita
let adminMonth = null; // 'AAAA-MM' scelto nel pannello
async function adminCall(azione, extra) {
  const res = await fetch(db.endpoint, { method: 'POST', body: JSON.stringify({ admin: Object.assign({ password: adminPwd, azione }, extra || {}) }) });
  return res.json();
}
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthParts = m => ({ anno: Number(m.slice(0, 4)), mese: Number(m.slice(5, 7)) - 1 });
const monthInput = () => `<label>Mese<input type="month" name="mese" value="${adminMonth || monthNow()}" required></label>`;
function busy(text) { openDialog(`<h3>${esc(text)}</h3><p>Un attimo…</p>`); }
function fail(msg) { openDialog(`<h3>Errore</h3><p>${esc(msg)}</p><button class="btn" value="back">Indietro</button>`, () => setTimeout(adminHome, 50)); }
function call(azione, extra, waitText, onOk) {
  busy(waitText);
  adminCall(azione, extra).then(out => {
    if (out.ok) onOk(out);
    else if (out.error === 'password' || out.error === 'bloccato') { adminPwd = null; setTimeout(() => adminLogin(out.msg), 50); }
    else fail(out.msg || 'Qualcosa non ha funzionato.');
  }).catch(() => fail('Serve la connessione internet.'));
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
        if (out.ok) adminHome();
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

function adminHome() {
  if (!db.adminDevice) { db.adminDevice = true; save(); }
  openDialog(`
    <h3>🔒 Area responsabile</h3>
    <div class="menu">
      <button class="btn ghost" value="sites">🏗️ Cantieri: aggiungi, togli, rinomina</button>
      <button class="btn ghost" value="report">📊 Report del mese: PDF, stampa, email, condividi</button>
      <button class="btn ghost" value="shifts">✏️ Modifica timbrature dei dipendenti</button>
      <button class="btn ghost" value="pwd">🔑 Cambia password</button>
      <button class="btn ghost" value="logout">Esci dall'area responsabile</button>
      <button class="btn ghost" value="forget">Nascondi l'area responsabile su questo telefono</button>
      <button class="btn" value="">Chiudi</button>
    </div>`, a => {
    const go = {
      sites: () => call('leggi', null, 'Carico i cantieri', out => adminSites(out.cantieri)),
      report: adminReportPick,
      shifts: adminShiftsPick,
      pwd: adminChangePassword,
      logout: () => { adminPwd = null; toast('Uscito dall\'area responsabile'); },
      forget: () => { adminPwd = null; db.adminDevice = false; save(); toast('Per rientrare: 5 tocchi veloci sul logo'); },
    }[a];
    if (go) setTimeout(go, 50);
  });
}

// --- Cantieri
function adminSites(list) {
  const row = (c, i) => `<div class="adm-row">
      <input name="n${i}" value="${esc(c.nome)}" maxlength="60" placeholder="Nome cantiere">
      <label class="adm-on"><input type="checkbox" name="a${i}" ${c.attivo ? 'checked' : ''}> Attivo</label>
    </div>`;
  openDialog(`
    <h3>🏗️ Cantieri</h3>
    <p>Togli la spunta per nascondere un cantiere: le timbrature fatte restano. Per eliminarlo svuota il nome.</p>
    <div class="adm-list" id="admList">${list.map(row).join('')}</div>
    <button type="button" class="btn ghost" id="admAdd">+ Aggiungi cantiere</button>
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="save">Salva</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      const n = $('#admList').children.length;
      const cantieri = [];
      for (let i = 0; i < n; i++) {
        const nome = String(fd.get('n' + i) || '').trim();
        if (nome) cantieri.push({ nome, attivo: fd.get('a' + i) === 'on' });
      }
      setTimeout(() => call('salva', { cantieri }, 'Salvo i cantieri', () => {
        toast('Cantieri salvati: arrivano su tutti i telefoni'); syncSites(); adminHome();
      }), 50);
    });
  $('#admAdd').onclick = () => {
    const i = $('#admList').children.length;
    $('#admList').insertAdjacentHTML('beforeend', row({ nome: '', attivo: true }, i));
    $('#admList').lastElementChild.querySelector('input').focus();
  };
}

// --- Report
function adminReportPick() {
  openDialog(`
    <h3>📊 Report del mese</h3>
    ${monthInput()}
    <div class="row"><button class="btn ghost" value="back" formnovalidate>Indietro</button><button class="btn" value="ok">Mostra</button></div>`,
    (a, fd) => {
      if (a === 'back') return setTimeout(adminHome, 50);
      adminMonth = String(fd.get('mese'));
      setTimeout(() => call('report', monthParts(adminMonth), 'Preparo il report', adminReport), 50);
    });
}
const num = v => typeof v === 'number' ? String(v).replace('.', ',') : esc(v);
function reportTable(r) {
  return `<table class="rep"><thead><tr>${r.intest.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${r.righe.map(row => `<tr>${row.map(v => `<td>${num(v)}</td>`).join('')}</tr>`).join('')}
    <tr class="tot">${r.totale.map(v => `<td>${num(v)}</td>`).join('')}</tr></tbody></table>`;
}
let lastReport = null;
function adminReport(r) {
  lastReport = r;
  openDialog(`
    <h3>Ore del personale – ${esc(r.nomeMese)}</h3>
    ${r.righe.length ? `<div class="rep-wrap">${reportTable(r)}</div>` : '<p>Nessuna timbratura in questo mese.</p>'}
    <div class="menu">
      <button class="btn" value="pdf">📄 Scarica / condividi PDF</button>
      <button class="btn ghost" value="print">🖨️ Stampa</button>
      <button class="btn ghost" value="email">📧 Invia per email al responsabile</button>
      <button class="btn ghost" value="back">Indietro</button>
    </div>`, a => {
    const p = monthParts(adminMonth);
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
    <h1>Ore del personale – ${esc(r.nomeMese)}</h1>${reportTable(r)}
    <p class="print-foot">Stampato il ${new Date().toLocaleDateString('it-IT')}</p>`;
  if (dlg.open) dlg.close();
  setTimeout(() => { window.print(); setTimeout(() => adminReport(r), 300); }, 100);
}

// --- Timbrature
let adminShifts = null, adminSitesList = [];
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
        <b>${esc(t.dip)}</b> · ${esc(t.cantiere)}<br>
        <span>${fmtDate(t.start)} · ${fmtTime(t.start)} → ${t.end ? fmtTime(t.end) + ' · ' + fmtDur(t.end - t.start) : '<em>in corso</em>'}</span>
      </button>`).join('') : '<p>Nessuna timbratura.</p>'}</div>
    <button class="btn ghost" value="back">Indietro</button>`, () => setTimeout(adminHome, 50));
  $('#admWho').onchange = e => adminShiftList(e.target.value);
  document.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => adminShiftEdit(b.dataset.sid, filter); });
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
window.addEventListener('online', () => { flush(); syncSites(); });
syncSites();
setInterval(flush, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { db = load(); db.queue = db.queue || []; db.endpoint = db.endpoint || DEFAULT_ENDPOINT; render(); flush(); syncSites(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
