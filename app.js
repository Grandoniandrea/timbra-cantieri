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
const APP_VERSION = 20;
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
// Posizione del telefono al momento della timbratura (se l'operatore dà il permesso)
function getPos() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ errore: 'non supportata' });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => resolve({ errore: e.code === 1 ? 'permesso negato' : 'segnale assente' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 });
  });
}
function clockIn(siteId) {
  if (db.active) return;
  db.active = { id: uid(), siteId, start: Date.now() };
  enqueueUpsert({ id: db.active.id, siteId, start: db.active.start, end: null });
  save();
  const id = db.active.id;
  getPos().then(pos => {
    if (db.active && db.active.id === id) {
      db.active.posIn = pos;
      enqueueUpsert(Object.assign({}, db.active, { end: null }));
    } else {
      const s = db.shifts.find(x => x.id === id);
      if (!s) return;
      s.posIn = pos; enqueueUpsert(s);
    }
    save();
  });
  return db.active;
}
function clockOut() {
  if (!db.active) return null;
  const shift = { id: db.active.id || uid(), siteId: db.active.siteId, start: db.active.start, end: Date.now(), posIn: db.active.posIn };
  getPos().then(pos => {
    const s = db.shifts.find(x => x.id === shift.id);
    if (!s) return;
    s.posOut = pos; enqueueUpsert(s); save();
  });
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
      <div class="bar"><span id="bar"></span></div>
      <p id="left"></p>
      <p>Entrata alle ${fmtTime(db.active.start)} · fine prevista alle ${fmtTime(db.active.start + cfg().oreTurno * 3600000)}</p>
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
    $('#btnOut').onclick = () => { const sh = clockOut(); if (sh) afterClockOut(sh, false); };
  } else {
    st.className = 'card status';
    st.innerHTML = `
      <small>PRONTO A TIMBRARE</small>${(document.title = 'Timbra Cantieri', '')}
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
  $('#foot').textContent = (managed
    ? 'Le timbrature vengono inviate al registro aziendale.'
    : 'I dati restano su questo telefono. Fai un backup ogni tanto dal menu ⋯') + ` · versione ${APP_VERSION}`;
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
      <span class="log-dur">${fmtDur(s.end - s.start)}${extraMin(s) ? `<small class="extra-tag">+${fmtDur(extraMin(s) * 60000)} extra</small>` : ''}</span>
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
    if (shift) afterClockOut(shift, true);
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
    <button class="btn ghost" value="csv">⬇︎ Scarica le mie timbrature (Excel)</button>
    <button class="btn ghost" value="">Chiudi</button>
  </div>` : `
  <h3>Menu</h3>
  <p>${esc(syncStatus())}</p>
  <div class="menu">
    ${db.endpoint ? '<button class="btn" value="admin">🔒 Area responsabile</button>' : ''}
    <button class="btn ghost" value="share">📤 Invia timbrature del mese</button>
    <button class="btn ghost" value="assenze">🌴 Ferie, permessi, malattia</button>
    <button class="btn ghost" value="csv">⬇︎ Esporta tutte le timbrature (Excel)</button>
    <button class="btn ghost" value="profile">👤 Cambia nome e cognome</button>
    <button class="btn ghost" value="backup">💾 Salva backup completo</button>
    <button class="btn ghost" value="restore">♻︎ Ripristina da backup</button>
    <button class="btn ghost" value="nfc">🏷️ Link da scrivere sul tag NFC</button>
    <button class="btn ghost" value="">Chiudi</button>
  </div>`, action => {
  if (action === 'share') shareMonth();
  if (action === 'assenze') setTimeout(myAbsences, 50);
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
  if (first) $('#dlgBody .dlg-x').remove();
}
$('#btnWho').onclick = () => editProfile();

// ---------- Registro aziendale (Google Sheet) ----------
// Ogni modifica va in coda e viene inviata appena c'è rete: funziona anche senza campo.
function enqueue(op) {
  op.opId = uid();
  // Per la stessa timbratura conta solo l'ultima operazione.
  const keyOf = o => o.shift ? o.shift.id : o.assenza ? o.assenza.id : o.id;
  const key = keyOf(op);
  db.queue = db.queue.filter(o => keyOf(o) !== key);
  db.queue.push(op);
}
function enqueueUpsert(s) {
  enqueue({ type: 'upsert', shift: { id: s.id, start: s.start, end: s.end || null, site: siteById(s.siteId).name,
    extra: s.extra || null, posIn: s.posIn || null, posOut: s.posOut || null } });
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
    const res = await withTimeout(fetch(`${db.endpoint}?azione=assenze&device=${encodeURIComponent(db.user.device)}`), 20000);
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
  const res = await fetch(db.endpoint, { method: 'POST', body: JSON.stringify({ admin: Object.assign({ password: adminPwd, azione }, extra || {}) }) });
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
        if (out.ok) { adminExtraCount = out.extraInAttesa || 0; adminAbsCount = out.assenzeInAttesa || 0; adminHome(); }
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
      <button class="btn ghost" value="extra">⏱️ Ore extra da autorizzare${adminExtraCount ? ` <span class="badge">${adminExtraCount}</span>` : ''}</button>
      <button class="btn ghost" value="assenze">🌴 Ferie, permessi, malattia${adminAbsCount ? ` <span class="badge">${adminAbsCount}</span>` : ''}</button>
      <button class="btn ghost" value="shifts">✏️ Modifica timbrature dei dipendenti</button>
      <button class="btn ghost" value="pwd">🔑 Cambia password</button>
      <button class="btn ghost danger-text" value="reset">🧹 Azzera tutto e parti da zero</button>
      <button class="btn ghost" value="logout">Esci dall'area responsabile</button>
      <button class="btn ghost" value="forget">Nascondi l'area responsabile su questo telefono</button>
      <button class="btn" value="">Chiudi</button>
    </div>`, a => {
    const go = {
      sites: () => call('leggi', null, 'Carico i cantieri', out => adminSites(out.cantieri)),
      report: adminReportPick,
      shifts: adminShiftsPick,
      extra: () => call('extra', null, 'Carico le richieste', out => adminExtra(out.extra)),
      assenze: () => call('assenze', null, 'Carico ferie e permessi', out => adminAbsences(out.assenze)),
      pwd: adminChangePassword,
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
