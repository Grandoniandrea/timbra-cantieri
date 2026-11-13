'use strict';
// GE3CO · Area responsabile — dashboard per computer e iPhone.
// Usa lo stesso registro Google (Apps Script) dell'app Timbra Cantieri, con la password del responsabile.
// La password resta solo in memoria: chiusa la pagina va reinserita.

// ---------- Registro ----------
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwrPn7c9W0Dl9mUZGq6Yp35uhv2wprrhOUFFB4PF50ZYtIhY2o1bVugEYrmIJh3NJf6xw/exec';
const ENDPOINT = (() => {
  try { const d = JSON.parse(localStorage.getItem('timbra-cantieri.v1') || '{}'); return d.endpoint || DEFAULT_ENDPOINT; } catch (e) { return DEFAULT_ENDPOINT; }
})();
const APP_URL = '../';
const ORE_GEOFOR = 5, ORE_IMPIANTO = 8, FINESTRA_SCAD = 60;
const TURNI = [{ nome: 'Mattina', da: 6 * 60, a: 11 * 60, orario: '06–11' }, { nome: 'Pomeriggio', da: 13 * 60, a: 18 * 60, orario: '13–18' }];
const ASSENZE = ['Ferie', 'Malattia', 'Permesso'];

const S = {
  pwd: null, demo: false, view: 'dashboard', q: '',
  month: null, tFilter: 'tutte', iFilter: 'dafare', week: null,
  cantieri: [], extraN: 0, assN: 0,
  cache: {}, loading: {}
};

// ---------- Utilità ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = iso => new Date(iso + 'T12:00:00');
const todayIso = () => isoOf(new Date());
const addDays = (iso, n) => { const d = dayOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const mondayOf = iso => { const d = dayOf(iso); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return isoOf(d); };
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthParts = m => ({ anno: Number(m.slice(0, 4)), mese: Number(m.slice(5, 7)) - 1 });
const monthName = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fmtDay = t => new Date(t).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtIso = iso => iso ? dayOf(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtIsoShort = iso => iso ? dayOf(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const fmtH = h => (Math.round(h * 10) / 10).toLocaleString('it-IT');
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)} h ${pad(m % 60)}`; };
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const initials = n => String(n).trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const cap = s => String(s || '').toLowerCase().replace(/(^|[\s/'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const impianto = c => /ECOFOR|ECOACCIAI|ECO ACCIAI/i.test(String(c));
const oreTurno = c => impianto(c) ? ORE_IMPIANTO : ORE_GEOFOR;
const daysTo = iso => iso ? Math.round((dayOf(iso) - dayOf(todayIso())) / 864e5) : null;
const match = (...parts) => !S.q || parts.join(' ').toLowerCase().includes(S.q.toLowerCase());
const isMap = v => /^https:/.test(String(v || ''));
const chip = (cls, t) => `<span class="chip ${cls}">${esc(t)}</span>`;

const I = {
  dashboard: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  timbrature: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  programma: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  interventi: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  richieste: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h4"/>',
  dpi: '<path d="M8 3l-5 4 3 4 2-1v11h8V10l2 1 3-4-5-4a4 4 0 0 1-8 0z"/>',
  statistiche: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  dipendenti: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/>',
  impostazioni: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  esci: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'
};
const icon = (k, extra) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${I[k] || ''}</svg>`;

const VIEWS = {
  dashboard: ['Dashboard', 'Turni, squadre e cantieri: tutto in un posto.'],
  timbrature: ['Timbrature', 'Entrate e uscite degli operatori, con la posizione.'],
  programma: ['Programma', 'Squadre della settimana per cantiere e specchietto ore.'],
  interventi: ['Interventi', 'Segnalazioni da assegnare e quelle chiuse con le foto.'],
  richieste: ['Ferie e richieste', 'Ore extra, ferie, permessi e malattia da approvare.'],
  dpi: ['DPI e vestiario', 'Consegne, scadenze e cosa ordinare.'],
  statistiche: ['Statistiche', 'Ore del mese per cantiere e per dipendente.'],
  dipendenti: ['Dipendenti', 'Visite mediche e corsi di formazione: scadenze.'],
  impostazioni: ['Impostazioni', 'Link di invito, password e app.']
};
const MENU = ['dashboard', 'timbrature', 'programma', 'interventi', 'richieste', 'dpi', 'statistiche', 'dipendenti'];
const TABS = ['dashboard', 'timbrature', 'programma', 'richieste'];

// ---------- Chiamate al registro ----------
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function api(azione, extra) {
  if (S.demo) return demoApi(azione, extra || {});
  const res = await withTimeout(fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ admin: Object.assign({ password: S.pwd, azione }, extra || {}) }) }), 30000);
  const out = await res.json();
  if (!out.ok && (out.error === 'password' || out.error === 'bloccato')) { logout(out.msg || 'Accedi di nuovo.'); throw new Error('auth'); }
  if (!out.ok) throw new Error(out.msg || out.error || 'Errore del registro');
  return out;
}
function why(e) {
  if (e && e.message === 'auth') return '';
  if (e && e.message === 'timeout') return 'Il registro non ha risposto entro 30 secondi. Riprova tra poco.';
  if (navigator.onLine === false) return 'Serve la connessione internet.';
  return (e && e.message) || 'Qualcosa non ha funzionato.';
}
// Le richieste allo script vanno una alla volta (lo script le mette in fila comunque)
let chain = Promise.resolve();
function queued(azione, extra) { const p = chain.then(() => api(azione, extra)); chain = p.catch(() => {}); return p; }
// Carica un dato una volta sola e ridisegna la pagina quando arriva
function need(key, azione, extra, map) {
  if (key in S.cache || S.loading[key]) return S.cache[key];
  S.loading[key] = true;
  queued(azione, extra).then(out => { S.cache[key] = map ? map(out) : out; },
    e => { S.cache[key] = { error: why(e) }; })
    .finally(() => { delete S.loading[key]; if (S.pwd || S.demo) renderPage(); });
  return undefined;
}
const tKey = m => 't:' + m;
const needMonth = m => need(tKey(m), 'timbrature', monthParts(m), o => o.timbrature || []);
const needWeek = w => need('p:' + w, 'programma', { da: w, a: addDays(w, 6) });
const needExtra = () => need('extra', 'extra', null, o => o.extra || []);
const needAss = () => need('assenze', 'assenze', null, o => o.assenze || []);
const needInt = () => need('interventi', 'interventi');
const needScad = () => need('scad', 'scad');
const needDpi = () => need('dpi', 'dpi');
function refresh() { S.cache = {}; renderPage(); toast('Aggiorno i dati…'); }
function invalidate(...keys) { keys.forEach(k => delete S.cache[k]); }

// ---------- Accesso ----------
function renderLogin(msg) {
  stopClock();
  $('#root').innerHTML = `
  <main class="login">
    <form class="login-card" id="loginForm">
      <img src="../logo.png" alt="GE3CO Gestione Ecologia" width="131" height="40">
      <div><h1>Area responsabile</h1><p>Timbra Cantieri · solo per l'amministratore. Dopo 5 tentativi sbagliati l'accesso si blocca per 15 minuti.</p></div>
      <label class="field">Password<input type="password" name="pwd" autocomplete="current-password" required></label>
      <p class="msg" id="loginMsg">${esc(msg || '')}</p>
      <button class="btn block" type="submit" id="loginBtn">Entra</button>
      <button class="btn plain block" type="button" data-act="demo">Prova con dati finti</button>
      <p class="sub" style="color:var(--muted);font-size:13px">Sull'iPhone: Condividi → <b>Aggiungi alla schermata Home</b> per averla come app.</p>
    </form>
  </main>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pwd = String(new FormData(e.target).get('pwd') || '');
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Controllo la password…';
    S.pwd = pwd; S.demo = false;
    try {
      const out = await withTimeout(fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ admin: { password: pwd, azione: 'leggi' } }) }).then(r => r.json()), 30000);
      if (!out.ok) {
        S.pwd = null;
        return renderLogin(out.error === 'nopass' ? 'La password del responsabile non è ancora stata creata: creala dall\'app Timbra Cantieri (5 tocchi sul logo).' : (out.msg || 'Password sbagliata.'));
      }
      enter(out);
    } catch (err) { S.pwd = null; renderLogin(why(err)); }
  });
}
function enter(out) {
  S.cantieri = out.cantieri || [];
  S.extraN = out.extraInAttesa || 0; S.assN = out.assenzeInAttesa || 0;
  S.cache = {}; S.view = 'dashboard'; S.month = monthNow(); S.week = mondayOf(todayIso());
  renderShell();
}
function logout(msg) { S.pwd = null; S.demo = false; S.cache = {}; dlg.close(); renderLogin(msg); }

// ---------- Struttura ----------
function navBadge(v) {
  if (v === 'richieste') { const n = pendingCount(); return n ? `<span class="badge">${n}</span>` : ''; }
  if (v === 'interventi') { const x = S.cache.interventi; const n = x && x.interventi ? x.interventi.filter(i => i.stato !== 'Fatto').length : 0; return n ? `<span class="badge">${n}</span>` : ''; }
  return '';
}
function pendingCount() {
  const e = Array.isArray(S.cache.extra) ? S.cache.extra.length : S.extraN;
  const a = Array.isArray(S.cache.assenze) ? S.cache.assenze.filter(x => x.stato === 'Da approvare').length : S.assN;
  return e + a;
}
function renderShell() {
  $('#root').innerHTML = `
  <div class="app">
    <aside class="side">
      <button class="brand" data-go="dashboard" aria-label="Dashboard"><img src="../logo.png" alt="" width="131" height="40"><span>Timbra Cantieri</span></button>
      <nav class="nav" aria-label="Menu principale" id="navMain"></nav>
      <nav class="nav" aria-label="Generale">
        <p class="nav-title">GENERALE</p>
        <button data-go="impostazioni">${icon('impostazioni')}Impostazioni</button>
        <button data-act="logout">${icon('esci')}Esci</button>
      </nav>
      <div class="promo">
        <div class="ic"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1d2903" stroke-width="2" stroke-linecap="round">${I.phone}</svg></div>
        <b>Invita un operatore</b>
        <p>Mandagli il link: timbra dal telefono con la card NFC.</p>
        <button class="btn lime sm" data-act="invite">Link di invito</button>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="phone-brand" data-go="dashboard" aria-label="Dashboard"><img src="../logo.png" alt="GE3CO" width="105" height="32"></button>
        <label class="search"><span class="sr">Cerca</span>${icon('search', 'width="18" height="18" style="color:var(--muted)"')}<input type="search" id="q" placeholder="Cerca operatore, cantiere, indirizzo" value="${esc(S.q)}" autocomplete="off"></label>
        <div class="top-r">
          <button class="icon-btn" data-act="refresh" aria-label="Aggiorna i dati">${icon('refresh')}</button>
          <button class="icon-btn" data-go="richieste" aria-label="Richieste da approvare" id="bell">${icon('bell')}</button>
          <div class="me"><div class="avatar" aria-hidden="true">AG</div><div class="who"><b>Andrea Grandoni</b><small>${S.demo ? 'Modalità prova' : 'Amministratore'}</small></div></div>
        </div>
      </header>
      ${S.demo ? '<div class="demo-bar">Modalità prova: dati finti, non tocca il registro vero. <button class="link" data-act="logout">Esci dalla prova</button></div>' : ''}
      <section class="page" id="page" aria-live="polite"></section>
    </div>
  </div>
  <nav class="tabbar" aria-label="Menu" id="tabbar"></nav>`;
  $('#q').addEventListener('input', e => { S.q = e.target.value.trim(); renderPage(); });
  renderPage();
}
function renderNav() {
  const main = $('#navMain'); if (!main) return;
  main.innerHTML = '<p class="nav-title">MENU</p>' + MENU.map(v => `<button data-go="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${icon(v)}<span>${VIEWS[v][0]}</span>${navBadge(v)}</button>`).join('');
  document.querySelectorAll('.nav [data-go="impostazioni"]').forEach(b => S.view === 'impostazioni' ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  const tb = $('#tabbar');
  tb.innerHTML = TABS.map(v => `<button data-go="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${icon(v)}<span>${v === 'richieste' ? 'Richieste' : VIEWS[v][0]}</span>${navBadge(v)}</button>`).join('') +
    `<button data-act="more" ${TABS.includes(S.view) ? '' : 'aria-current="page"'}>${icon('menu')}<span>Altro</span></button>`;
  const bell = $('#bell'); if (bell) bell.innerHTML = icon('bell') + (pendingCount() ? '<span class="dot"></span>' : '');
}
function go(v) { S.view = v; dlg.close(); window.scrollTo(0, 0); renderPage(); }

function head(actions) {
  const [t, p] = VIEWS[S.view];
  return `<div class="page-head"><div><h1>${t}</h1><p>${p}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
const loadingBox = (t) => `<p class="loading">${esc(t || 'Carico i dati dal registro…')}</p>`;
const errBox = e => `<p class="empty">⚠️ ${esc(e)} <button class="link" data-act="refresh">Riprova</button></p>`;

function renderPage() {
  const page = $('#page'); if (!page) return;
  stopClock();
  const fn = { dashboard: pDashboard, timbrature: pTimbrature, programma: pProgramma, interventi: pInterventi, richieste: pRichieste,
    dpi: pDpi, statistiche: pStatistiche, dipendenti: pDipendenti, impostazioni: pImpostazioni }[S.view] || pDashboard;
  try { page.innerHTML = fn(); } catch (e) { console.error(e); page.innerHTML = head() + errBox('La schermata non si è aperta: ' + e.message); }
  renderNav();
  if (S.view === 'dashboard') startClock();
}

// ---------- Dashboard ----------
function pDashboard() {
  const today = todayIso(), mon = mondayOf(today);
  const m = monthNow(), mPrev = mon.slice(0, 7);
  const tm = needMonth(m); const tp = mPrev !== m ? needMonth(mPrev) : [];
  const ex = needExtra(), as = needAss(), pl = needWeek(mon), it = needInt(), sc = needScad();
  const all = [].concat(Array.isArray(tm) ? tm : [], Array.isArray(tp) ? tp : []);
  const t0 = dayOf(today); t0.setHours(0, 0, 0, 0);
  const aperte = all.filter(t => !t.end && t.start >= t0.getTime());
  const extraN = Array.isArray(ex) ? ex.length : S.extraN;
  const assN = Array.isArray(as) ? as.filter(a => a.stato === 'Da approvare').length : S.assN;
  const attivi = S.cantieri.filter(c => c.attivo !== false);
  const kpi = (v, label, value, note, cls) => `<button class="card kpi ${cls || ''}" data-go="${v}">
      <span class="kpi-top"><span>${label}</span><span class="arrow">${icon('arrow')}</span></span>
      <strong>${value}</strong><span class="note ${cls === 'warnk' ? 'warn' : ''}">${note}</span></button>`;
  const kpis = `<div class="grid g-kpi">
    ${kpi('timbrature', 'In servizio ora', Array.isArray(tm) ? aperte.length : '…', Array.isArray(tm) ? `${all.filter(t => t.start >= t0.getTime()).length} timbrature oggi` : 'carico…', 'hero')}
    ${kpi('programma', 'Cantieri attivi', attivi.length, esc(attivi.slice(0, 3).map(c => cap(c.nome)).join(', ') || 'nessuno'))}
    ${kpi('richieste', 'Ore extra da autorizzare', extraN, extraN ? 'da decidere' : 'tutto a posto', extraN ? 'warnk' : '')}
    ${kpi('richieste', 'Assenze da approvare', assN, assN ? 'ferie, permessi, malattia' : 'tutto a posto', assN ? 'warnk' : '')}
  </div>`;

  // Ore timbrate della settimana (turni chiusi, ore effettive)
  const days = [...Array(7)].map((_, i) => addDays(mon, i));
  const ore = days.map(d => all.filter(t => t.end && isoOf(new Date(t.start)) === d).reduce((s, t) => s + (t.end - t.start) / 36e5, 0));
  const max = Math.max(1, ...ore);
  const peak = ore.indexOf(Math.max(...ore));
  const bars = days.map((d, i) => {
    const fut = d > today, isT = d === today;
    const h = fut ? 70 : Math.max(8, Math.round(ore[i] / max * 150));
    const cls = fut ? 'future' : isT ? 'today' : (i === peak && ore[i] > 0 ? 'peak' : '');
    return `<div class="bar-col">${isT || (i === peak && ore[i] > 0 && !fut) ? `<span class="tip">${fmtH(ore[i])} h</span>` : ''}<div class="bar ${cls}" style="height:${h}px" title="${fmtH(ore[i])} ore"></div><span>${'LMMGVSD'[i]}</span></div>`;
  }).join('');
  const weekCard = `<article class="card span-2"><div class="card-head"><h2>Ore timbrate questa settimana</h2><small>${Array.isArray(tm) ? `${fmtH(ore.reduce((a, b) => a + b, 0))} h · turni chiusi` : 'carico…'}</small></div>
    <div class="bars" role="img" aria-label="Ore timbrate per giorno: ${days.map((d, i) => `${fmtIsoShort(d)} ${fmtH(ore[i])}`).join(', ')}">${bars}</div></article>`;

  // Promemoria scadenze
  const vicine = sc && sc.righe ? scVicine(sc) : null;
  const memo = `<article class="card"><h2>Promemoria</h2>
    ${vicine === null ? (sc && sc.error ? errBox(sc.error) : loadingBox()) : vicine.length ? `
      <p style="font:700 26px/1.1 var(--font-d);color:var(--accent)">${vicine.length} ${vicine.length === 1 ? 'scadenza' : 'scadenze'} di visite e corsi</p>
      <p class="sub">${esc(vicine[0].operatore)} · ${esc(vicine[0].voce)} · ${scTxt(vicine[0])}</p>` : `<p style="font:700 24px/1.1 var(--font-d);color:var(--accent)">Visite e corsi in regola</p><p class="sub">Niente in scadenza nei prossimi ${FINESTRA_SCAD} giorni.</p>`}
    <button class="btn block" data-go="dipendenti" style="margin-top:auto">${icon('programma')}Vedi le scadenze</button></article>`;

  // Cantieri di oggi dal programma
  const sq = pl && pl.squadre ? pl.squadre.filter(s => s.data === today && !ASSENZE.includes(s.turno)) : null;
  const oggi = `<article class="card"><div class="card-head"><h2>Cantieri di oggi</h2><button class="btn ghost sm" data-go="programma">Programma</button></div>
    <div class="rows">${sq === null ? (pl && pl.error ? errBox(pl.error) : loadingBox()) : sq.length ? sq.slice(0, 6).map(s => `<div class="row"><span class="pin ${impianto(s.cantiere) ? '' : 'g'}">${icon('interventi')}</span>
      <div class="txt"><b>${esc(cap(s.cantiere))}</b><span>${esc(s.turno)}${turnoOrario(s.turno, s.cantiere)} · ${esc(s.operatori.join(', '))}</span></div></div>`).join('') + (sq.length > 6 ? `<p class="sub">e altre ${sq.length - 6} squadre</p>` : '')
      : '<p class="empty">Nessuna squadra in programma oggi.</p>'}</div></article>`;

  // Squadre in servizio (turni aperti)
  const team = `<article class="card span-2"><div class="card-head"><h2>Operatori in servizio</h2><button class="btn ghost sm" data-go="timbrature">Tutte le timbrature</button></div>
    <div class="rows">${!Array.isArray(tm) ? (tm && tm.error ? errBox(tm.error) : loadingBox()) : aperte.length ? aperte.slice(0, 7).map((t, i) => `<div class="row">
      <div class="ini c${i % 4}" aria-hidden="true">${esc(initials(t.dip))}</div>
      <div class="txt"><b>${esc(t.dip)}</b><span>Su <strong style="color:var(--ink)">${esc(cap(t.cantiere))}</strong> · entrata ${fmtTime(t.start)} · ${fmtDur(Date.now() - t.start)}</span></div>
      ${statoTimbratura(t)}</div>`).join('') : '<p class="empty">Nessun turno aperto in questo momento.</p>'}</div></article>`;

  // Interventi del mese
  const ints = it && it.interventi ? it.interventi.filter(x => (x.data || '').slice(0, 7) === m) : null;
  let gauge;
  if (ints === null) gauge = it && it.error ? errBox(it.error) : loadingBox();
  else {
    const fatti = ints.filter(x => x.stato === 'Fatto').length, tot = ints.length, pct = tot ? Math.round(fatti / tot * 100) : 0;
    const L = 282.7, off = L * (1 - pct / 100);
    gauge = `<div class="gauge"><svg viewBox="0 0 220 120" role="img" aria-label="${pct} per cento degli interventi del mese fatti">
      <path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#e3e6dc" stroke-width="26" stroke-linecap="round"/>
      ${pct ? `<path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="var(--accent)" stroke-width="26" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${off}"/>` : ''}
      </svg><b>${pct}%</b></div>
      <p class="sub" style="text-align:center">interventi del mese fatti</p>
      <div class="legend"><span><i style="background:var(--accent)"></i>Fatti ${fatti}</span><span><i style="background:#e3e6dc;border:1px solid #c9ccc2"></i>Da fare ${tot - fatti}</span></div>`;
  }
  const intCard = `<article class="card"><div class="card-head"><h2>Interventi</h2><button class="btn ghost sm" data-go="interventi">Apri</button></div>${gauge}</article>`;

  const clock = `<article class="card clock" id="clockCard">
    <svg class="rings" aria-hidden="true" viewBox="0 0 200 200"><g fill="none" stroke="#95c11f" stroke-width="1"><circle cx="100" cy="100" r="90"/><circle cx="100" cy="100" r="70"/><circle cx="100" cy="100" r="50"/><circle cx="100" cy="100" r="30"/></g></svg>
    <div id="clockBody"></div></article>`;

  return head(`<button class="btn" data-act="newInt">${icon('plus')}Nuovo intervento</button><button class="btn ghost" data-go="statistiche">Report del mese</button>`) +
    kpis +
    `<div class="grid g-3">${weekCard}${memo}${oggi}</div>` +
    `<div class="grid g-3">${team}${intCard}${clock}</div>` +
    `<p class="foot">Dati dal registro Google di Timbra Cantieri · aggiornati all'apertura · ${S.demo ? 'modalità prova' : 'tocca ↻ per aggiornare'}</p>`;
}
function turnoOrario(turno, cantiere) {
  if (impianto(cantiere)) return /ECOFOR/i.test(cantiere) ? ' 07–15:30' : ' 08–16';
  const t = TURNI.find(x => x.nome === turno); return t ? ' ' + t.orario : '';
}
function statoTimbratura(t) {
  if (/FUORI/i.test(t.sede)) return chip('no', 'Fuori sede');
  if (!t.end && Date.now() - t.start > (oreTurno(t.cantiere) + 1) * 36e5) return chip('wait', 'Uscita mancante');
  if (t.statoExtra === 'Da autorizzare') return chip('wait', 'Extra da autorizzare');
  if (!t.end) return chip('ok', 'In servizio');
  return chip('grey', 'Chiusa');
}
// Orologio del turno Geofor in corso (06–11 / 13–18)
let clockTimer = null;
function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
function startClock() {
  const paint = () => {
    const box = $('#clockBody'); if (!box) return stopClock();
    const now = new Date(), min = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const cur = TURNI.find(t => min >= t.da && min < t.a);
    const next = TURNI.find(t => min < t.da);
    if (cur) {
      const el = (min - cur.da) * 60, left = (cur.a - min) * 60;
      const hh = Math.floor(el / 3600), mm = Math.floor(el / 60) % 60, ss = Math.floor(el) % 60;
      box.innerHTML = `<h2 style="font:600 18px var(--font-b)">Turno di ${cur.nome.toLowerCase()}</h2><p class="sub">${cur.orario} · tempo trascorso</p>
        <strong style="display:block;margin:12px 0">${pad(hh)}:${pad(mm)}:${pad(ss)}</strong>
        <div class="track"><i style="width:${Math.round((min - cur.da) / (cur.a - cur.da) * 100)}%"></i></div>
        <p class="sub" style="margin-top:10px">Mancano ${Math.floor(left / 3600)} h ${pad(Math.floor(left / 60) % 60)} min alla fine del turno</p>`;
    } else {
      const target = next ? next.da : TURNI[0].da + 1440;
      const left = (target - min) * 60;
      box.innerHTML = `<h2 style="font:600 18px var(--font-b)">Prossimo turno</h2><p class="sub">${next ? next.nome + ' ' + next.orario : 'Mattina 06–11 di domani'}</p>
        <strong style="display:block;margin:12px 0">${pad(Math.floor(left / 3600))}:${pad(Math.floor(left / 60) % 60)}:${pad(Math.floor(left) % 60)}</strong>
        <div class="track"><i style="width:0%"></i></div>
        <p class="sub" style="margin-top:10px">Turni Geofor da 5 ore · impianti da 8 ore</p>`;
    }
  };
  paint(); clockTimer = setInterval(paint, 1000);
}

// ---------- Timbrature ----------
function pTimbrature() {
  const m = S.month || monthNow();
  const data = needMonth(m);
  const filters = [['tutte', 'Tutte'], ['aperte', 'Turni aperti'], ['fuori', 'Fuori sede'], ['extra', 'Con extra'], ['ritardi', 'Ritardi']];
  const tools = `<div class="toolbar"><label><span class="sr">Mese</span><input type="month" id="monthPick" value="${m}"></label>
    <div class="pill-tabs">${filters.map(([k, l]) => `<button data-tf="${k}" aria-pressed="${S.tFilter === k}">${l}</button>`).join('')}</div></div>`;
  let body;
  if (!Array.isArray(data)) body = data && data.error ? errBox(data.error) : loadingBox();
  else {
    const f = { tutte: () => true, aperte: t => !t.end, fuori: t => /FUORI/i.test(t.sede), extra: t => t.extra > 0, ritardi: t => t.tolti > 0 }[S.tFilter] || (() => true);
    const rows = data.filter(f).filter(t => match(t.dip, t.cantiere, t.sede));
    const ore = rows.filter(t => t.end).reduce((s, t) => s + (t.end - t.start) / 36e5, 0);
    body = `<p class="sub">${rows.length} timbrature · ${fmtH(ore)} ore effettive · ${monthName(m)}</p>
    <div class="table-box"><table><thead><tr><th>Giorno</th><th>Operatore</th><th>Cantiere</th><th>Entrata</th><th>Uscita</th><th>Durata</th><th>Posizione</th><th>Extra</th><th>Stato</th></tr></thead><tbody>
    ${rows.map(t => `<tr><td>${fmtDay(t.start)}</td><td class="name">${esc(t.dip)}</td><td>${esc(cap(t.cantiere))}<span class="small">${esc(t.turno || '')}</span></td>
      <td>${fmtTime(t.start)}${t.tolti ? `<span class="small" style="color:#9a4a05">ritardo −${t.tolti} min</span>` : ''}</td><td>${t.end ? fmtTime(t.end) : '—'}</td><td>${t.end ? fmtDur(t.end - t.start) : fmtDur(Date.now() - t.start)}</td>
      <td>${esc(cap(t.sede) || '—')}${isMap(t.posIn) ? ` <a href="${esc(t.posIn.split(' ')[0])}" target="_blank" rel="noopener">mappa</a>` : ''}</td>
      <td>${t.extra ? `+${t.extra} min<span class="small">${esc(t.statoExtra)}</span>` : '—'}</td><td>${statoTimbratura(t)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nessuna timbratura con questi filtri.</td></tr>'}
    </tbody></table></div>
    <p class="foot">Per correggere una timbratura usa l'app Timbra Cantieri → area responsabile → Modifica timbrature.</p>`;
  }
  return head(`<a class="btn ghost" href="${APP_URL}" target="_blank" rel="noopener">Apri l'app operatori</a>`) + tools + body;
}

// ---------- Programma ----------
function pProgramma() {
  const w = S.week || mondayOf(todayIso());
  const pl = needWeek(w);
  const days = [...Array(7)].map((_, i) => addDays(w, i));
  const today = todayIso();
  const tools = `<div class="toolbar weeknav">
    <button class="icon-btn" data-week="-7" aria-label="Settimana precedente">${icon('left')}</button>
    <b>Dal ${dayOf(w).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} al ${dayOf(days[6]).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</b>
    <button class="icon-btn" data-week="7" aria-label="Settimana successiva">${icon('right')}</button>
    ${w !== mondayOf(today) ? '<button class="btn plain sm" data-week="0">Questa settimana</button>' : ''}</div>`;
  if (!pl || pl.error) return head() + tools + (pl && pl.error ? errBox(pl.error) : loadingBox());
  const squadre = pl.squadre.filter(s => match(s.cantiere, s.operatori.join(' '), s.turno));
  const lavoro = squadre.filter(s => !ASSENZE.includes(s.turno));
  const cantieri = [...new Set(lavoro.map(s => s.cantiere))].sort();
  const cell = (list, cls) => list.map(s => `<span class="sq ${cls || ''}"><i>${esc(s.turno)}</i> ${esc(s.operatori.join(', '))}</span>`).join('') || '<span class="small" style="color:#9a9a96">—</span>';
  const rows = cantieri.map(c => `<tr><td class="name">${esc(cap(c))}<span class="small">${impianto(c) ? 'Impianto · 8 h' : 'Geofor · 5 h'}</span></td>
    ${days.map(d => `<td class="${d === today ? 'today-col' : ''}">${cell(lavoro.filter(s => s.cantiere === c && s.data === d))}</td>`).join('')}</tr>`).join('');
  const ass = squadre.filter(s => ASSENZE.includes(s.turno));
  const assRow = ass.length ? `<tr><td class="name">Assenze</td>${days.map(d => `<td class="${d === today ? 'today-col' : ''}">${cell(ass.filter(s => s.data === d), 'ass')}</td>`).join('')}</tr>` : '';
  const table = `<div class="table-box plan"><table><thead><tr><th>Cantiere</th>${days.map(d => `<th class="${d === today ? 'today-col' : ''}">${dayOf(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })}</th>`).join('')}</tr></thead>
    <tbody>${rows + assRow || '<tr><td colspan="8" class="empty">Nessuna squadra in programma questa settimana.</td></tr>'}</tbody></table></div>`;

  // Specchietto ore: programma della settimana contro ore da contratto
  const ops = (pl.operatori || []).filter(o => o.attivo !== false);
  const ore = {};
  pl.squadre.forEach(s => s.operatori.forEach(o => {
    const k = o.trim().toLowerCase(); const x = ore[k] || (ore[k] = { nome: o, h: 0 });
    x.h += ASSENZE.includes(s.turno) ? ORE_GEOFOR : oreTurno(s.cantiere);
  }));
  const names = new Map(); ops.forEach(o => names.set(o.nome.toLowerCase(), o)); Object.values(ore).forEach(x => { if (!names.has(x.nome.toLowerCase())) names.set(x.nome.toLowerCase(), { nome: x.nome, ore: 30 }); });
  const box = [...names.values()].map(o => {
    const h = (ore[o.nome.toLowerCase()] || { h: 0 }).h, max = o.ore || 30, d = h - max;
    return { nome: o.nome, h, max, st: d > 0 ? 'over' : d < 0 ? 'under' : 'ok' };
  }).filter(r => match(r.nome)).sort((a, b) => ({ over: 0, under: 1, ok: 2 })[a.st] - ({ over: 0, under: 1, ok: 2 })[b.st] || a.nome.localeCompare(b.nome));
  const lbl = { over: ['no', 'sfora'], under: ['wait', 'sotto'], ok: ['ok', 'in regola'] };
  const spec = `<article class="card"><div class="card-head"><h2>Specchietto ore</h2><small>programma contro contratto</small></div>
    <div class="rows">${box.map(r => `<div style="display:grid;gap:6px"><div class="row"><div class="txt"><b>${esc(r.nome)}</b></div><span class="sub"><b style="color:var(--ink)">${fmtH(r.h)}</b>/${fmtH(r.max)} h</span>${chip(lbl[r.st][0], lbl[r.st][1])}</div>
      <div class="meter"><i class="${r.st === 'ok' ? '' : r.st}" style="width:${Math.min(100, r.max ? r.h / r.max * 100 : 0)}%"></i></div></div>`).join('') || '<p class="empty">Nessun operatore.</p>'}</div></article>`;
  return head(`<a class="btn ghost" href="${APP_URL}" target="_blank" rel="noopener">Modifica nell'app</a>`) + tools + table + `<div class="grid g-2">${spec}<article class="card"><h2>Come leggere</h2>
    <p class="sub">Ogni turno vale le ore del suo cantiere: Geofor 5 h, Ecofor Service ed Ecoacciai 8 h. Ferie, malattia e permesso contano 5 h. Le squadre si compongono dall'app Timbra Cantieri (area responsabile → Programma della settimana).</p></article></div>`;
}

// ---------- Interventi ----------
function pInterventi() {
  const it = needInt();
  const tools = `<div class="pill-tabs">${[['dafare', 'Da fare'], ['fatti', 'Fatti'], ['tutti', 'Tutti']].map(([k, l]) => `<button data-if="${k}" aria-pressed="${S.iFilter === k}">${l}</button>`).join('')}</div>`;
  const actions = `<button class="btn" data-act="newInt">${icon('plus')}Nuovo intervento</button>`;
  if (!it || it.error) return head(actions) + tools + (it && it.error ? errBox(it.error) : loadingBox());
  const ops = (it.operatori || []).filter(o => o.attivo !== false).map(o => o.nome);
  const list = it.interventi.filter(x => S.iFilter === 'tutti' || (S.iFilter === 'fatti' ? x.stato === 'Fatto' : x.stato !== 'Fatto'))
    .filter(x => match(x.indirizzo, x.localita, x.cliente, x.cosa, x.assegnato, x.fattoDa));
  const card = x => {
    const fatto = x.stato === 'Fatto';
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.coord || [x.indirizzo, x.localita].filter(Boolean).join(', '))}`;
    return `<article class="card job">
      <div class="card-head">${fatto ? chip('ok', 'Fatto') : x.assegnato && x.assegnato !== 'Tutti' ? chip('grey', 'Assegnato') : chip('wait', 'Da assegnare')}<small>${esc(fmtIsoShort(x.data))}</small></div>
      <h3>${esc(x.indirizzo)}</h3>
      <p class="sub">${esc([x.localita, x.cliente].filter(Boolean).join(' · '))}</p>
      ${x.cosa ? `<p>${esc(x.cosa)}</p>` : ''}${x.note ? `<p class="sub">📝 ${esc(x.note)}</p>` : ''}
      ${fatto ? `<p class="sub">Fatto da <b style="color:var(--ink)">${esc(x.fattoDa)}</b>${x.fattoIl ? ` · ${fmtDay(x.fattoIl)} alle ${fmtTime(x.fattoIl)}` : ''}</p>${x.notaOp ? `<p class="sub">💬 ${esc(x.notaOp)}</p>` : ''}` : ''}
      <div class="photos">
        ${x.screenshot ? `<button class="photo" data-foto="screenshot" data-id="${esc(x.id)}">Segnalazione</button>` : ''}
        ${x.fotoPrima ? `<button class="photo" data-foto="prima" data-id="${esc(x.id)}">Foto prima</button>` : ''}
        ${x.fotoDopo ? `<button class="photo" data-foto="dopo" data-id="${esc(x.id)}">Foto dopo</button>` : ''}
      </div>
      ${fatto ? `<div class="actions"><button class="btn plain sm" data-reopen="${esc(x.id)}">Riapri</button>${isMap(x.posChiusura) ? `<a class="btn plain sm" href="${esc(x.posChiusura.split(' ')[0])}" target="_blank" rel="noopener">Dove è stato chiuso</a>` : ''}</div>` : `
      <div class="assign"><label class="sr" for="as-${esc(x.id)}">Assegna a</label><select id="as-${esc(x.id)}" data-assign-sel="${esc(x.id)}">
        ${['Tutti'].concat(ops).map(n => `<option value="${esc(n)}" ${sameName(n, x.assegnato) ? 'selected' : ''}>${n === 'Tutti' ? 'Tutti gli operatori' : esc(n)}</option>`).join('')}</select>
        <button class="btn sm" data-assign="${esc(x.id)}">Assegna</button></div>
      <div class="actions"><a class="btn plain sm" href="${maps}" target="_blank" rel="noopener">Naviga</a><button class="btn plain sm" data-editint="${esc(x.id)}">Modifica</button></div>`}
    </article>`;
  };
  return head(actions) + tools + (list.length ? `<div class="jobs">${list.map(card).join('')}</div>` : '<p class="empty">Nessun intervento qui.</p>');
}
function intById(id) { const it = S.cache.interventi; return it && it.interventi ? it.interventi.find(x => x.id === id) : null; }
// Solo i campi che lo script si aspetta: lo screenshot già salvato resta com'è
const intPayload = x => ({ id: x.id, data: x.data, cliente: x.cliente || '', indirizzo: x.indirizzo, localita: x.localita || '', coord: x.coord || '', cosa: x.cosa || '', note: x.note || '', assegnato: x.assegnato || 'Tutti' });
async function saveInt(x, okMsg) {
  try { const out = await queued('salvaintervento', { intervento: x }); S.cache.interventi = out; toast(okMsg || 'Intervento salvato'); }
  catch (e) { const w = why(e); if (w) toast(w); }
  renderPage();
}
function intForm(x) {
  const it = S.cache.interventi, ops = it && it.operatori ? it.operatori.filter(o => o.attivo !== false).map(o => o.nome) : [];
  x = x || { data: todayIso(), assegnato: 'Tutti' };
  openDlg(`<form id="intForm" style="display:grid;gap:12px">
    <h2>${x.id ? 'Modifica intervento' : 'Nuovo intervento'}</h2>
    <label class="field">Indirizzo<input name="indirizzo" required value="${esc(x.indirizzo || '')}" autocomplete="off"></label>
    <div class="grid g-2" style="gap:12px"><label class="field">Comune<input name="localita" value="${esc(x.localita || '')}"></label><label class="field">Giorno<input type="date" name="data" value="${esc(x.data || todayIso())}"></label></div>
    <label class="field">Cliente<input name="cliente" value="${esc(x.cliente || '')}"></label>
    <label class="field">Cosa ritirare<textarea name="cosa">${esc(x.cosa || '')}</textarea></label>
    <label class="field">Note per l'operatore<input name="note" value="${esc(x.note || '')}"></label>
    <label class="field">Assegna a<select name="assegnato">${['Tutti'].concat(ops).map(n => `<option value="${esc(n)}" ${sameName(n, x.assegnato) ? 'selected' : ''}>${n === 'Tutti' ? 'Tutti gli operatori' : esc(n)}</option>`).join('')}</select></label>
    <p class="sub">Lo screenshot della segnalazione si allega dall'app Timbra Cantieri.</p>
    <div class="actions">${x.id ? '<button type="button" class="btn plain" data-delint="' + esc(x.id) + '">Elimina</button>' : ''}<button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#intForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const y = Object.assign(intPayload(x), Object.fromEntries(['indirizzo', 'localita', 'data', 'cliente', 'cosa', 'note', 'assegnato'].map(k => [k, String(f.get(k) || '').trim()])));
    if (!x.id) delete y.id;
    dlg.close(); toast('Salvo l\'intervento…'); saveInt(y, x.id ? 'Intervento aggiornato' : 'Intervento creato');
  });
}
async function showFoto(id, tipo) {
  openDlg(`<h2>${tipo === 'screenshot' ? 'Segnalazione' : tipo === 'prima' ? 'Foto prima' : 'Foto dopo'}</h2><p class="loading" id="fotoBox">Carico la foto…</p><div class="actions"><button class="btn" data-act="close">Chiudi</button></div>`);
  try {
    const out = await queued('fotointervento', { id, tipo });
    const box = $('#fotoBox'); if (!box) return;
    box.outerHTML = out.foto ? `<img class="full" src="${esc(out.foto)}" alt="${esc(tipo)}">` : '<p class="empty">Foto non trovata.</p>';
  } catch (e) { const box = $('#fotoBox'); if (box) box.textContent = why(e); }
}

// ---------- Richieste ----------
function pRichieste() {
  const ex = needExtra(), as = needAss();
  const exBox = !Array.isArray(ex) ? (ex && ex.error ? errBox(ex.error) : loadingBox()) : ex.filter(x => match(x.dip, x.cantiere, x.motivo)).map(x => `<div class="req">
      <div class="txt"><b>${esc(x.dip)} · +${x.extra} min</b><span>${x.start ? fmtDay(x.start) : ''} · ${esc(cap(x.cantiere))}${x.start ? ` · ${fmtTime(x.start)}–${x.end ? fmtTime(x.end) : '…'}` : ''}</span>
      <span style="display:block">${esc(x.motivo || 'Motivo non indicato')}${x.nota ? ' · ' + esc(x.nota) : ''}</span></div>
      <div class="actions"><button class="btn sm" data-extra="${esc(x.id)}" data-ok="1">Autorizza</button><button class="btn plain sm" data-extra="${esc(x.id)}" data-ok="0">Rifiuta</button></div></div>`).join('') || '<p class="empty">Nessuna ora extra da autorizzare. ✓</p>';
  let asBox;
  if (!Array.isArray(as)) asBox = as && as.error ? errBox(as.error) : loadingBox();
  else {
    const list = as.filter(a => match(a.dip, a.tipo, a.nota));
    const wait = list.filter(a => a.stato === 'Da approvare'), done = list.filter(a => a.stato !== 'Da approvare').slice(0, 8);
    const line = a => `<div class="req"><div class="txt"><b>${esc(a.dip)} · ${esc(a.tipo)}</b>
      <span>${a.dal === a.al || !a.al ? fmtIso(a.dal) : `dal ${fmtIso(a.dal)} al ${fmtIso(a.al)}`}${a.giorni ? ` · ${a.giorni} g` : ''}${a.ore ? ` · ${fmtH(a.ore)} h` : ''}${a.nota ? ' · ' + esc(a.nota) : ''}</span></div>
      ${a.stato === 'Da approvare' ? `<div class="actions"><button class="btn sm" data-ass="${esc(a.id)}" data-ok="1">Approva</button><button class="btn plain sm" data-ass="${esc(a.id)}" data-ok="0">Rifiuta</button></div>` : chip(a.stato === 'Approvata' ? 'ok' : 'no', a.stato)}</div>`;
    asBox = (wait.map(line).join('') || '<p class="empty">Nessuna richiesta da approvare. ✓</p>') + (done.length ? `<p class="nav-title" style="margin:10px 0 0">ULTIME DECISE</p>${done.map(line).join('')}` : '');
  }
  return head() + `<div class="grid g-2">
    <article class="card"><div class="card-head"><h2>Ore extra da autorizzare</h2><small>contano solo se autorizzate</small></div>${exBox}</article>
    <article class="card"><div class="card-head"><h2>Ferie, permessi e malattia</h2><small>l'operatore vede l'esito</small></div>${asBox}</article></div>`;
}
async function decide(kind, id, ok, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }
  try {
    if (kind === 'extra') { const out = await queued('decidi', { id, approva: ok }); S.cache.extra = out.extra || []; S.extraN = S.cache.extra.length; invalidate(tKey(monthNow())); }
    else { const out = await queued('decidiassenza', { id, approva: ok }); S.cache.assenze = out.assenze || []; S.assN = S.cache.assenze.filter(a => a.stato === 'Da approvare').length; }
    toast(ok ? (kind === 'extra' ? 'Extra autorizzato' : 'Richiesta approvata') : 'Richiesta rifiutata');
  } catch (e) { const w = why(e); if (w) toast(w); }
  renderPage();
}

// ---------- DPI ----------
function pDpi() {
  const d = needDpi();
  if (!d || d.error) return head() + (d && d.error ? errBox(d.error) : loadingBox());
  const ops = new Set((d.operatori || []).filter(o => o.attivo !== false).map(o => o.nome.toLowerCase()));
  const last = {};
  d.consegne.forEach(c => { const k = c.operatore.toLowerCase() + '|' + c.capo.toLowerCase(); if (!last[k] || last[k].data < c.data) last[k] = c; });
  const righe = Object.values(last).filter(c => !ops.size || ops.has(c.operatore.toLowerCase())).filter(c => match(c.operatore, c.capo))
    .map(c => { const g = daysTo(c.scadenza); return Object.assign({}, c, { g, st: g === null ? 'na' : g < 0 ? 'over' : g <= FINESTRA_SCAD ? 'under' : 'ok' }); })
    .sort((a, b) => ({ over: 0, under: 1, ok: 2, na: 3 })[a.st] - ({ over: 0, under: 1, ok: 2, na: 3 })[b.st] || (a.scadenza || '9').localeCompare(b.scadenza || '9'));
  const stChip = r => r.st === 'over' ? chip('no', `Scaduto da ${-r.g} g`) : r.st === 'under' ? chip('wait', r.g === 0 ? 'Scade oggi' : `Scade tra ${r.g} g`) : r.st === 'ok' ? chip('ok', 'In regola') : chip('grey', 'Senza scadenza');
  const ordine = {};
  righe.filter(r => r.st === 'over' || r.st === 'under').forEach(r => { const k = r.capo + (r.taglia ? ' · ' + r.taglia : ''); ordine[k] = (ordine[k] || 0) + (r.qta || 1); });
  return head(`<a class="btn ghost" href="${APP_URL}" target="_blank" rel="noopener">Registra una consegna</a>`) + `<div class="grid" style="gap:16px">
    <div class="table-box"><table><thead><tr><th>Operatore</th><th>Capo</th><th>Taglia</th><th>Consegnato</th><th>Scadenza</th><th>Stato</th></tr></thead><tbody>
    ${righe.map(r => `<tr><td class="name">${esc(r.operatore)}</td><td>${esc(r.capo)}</td><td>${esc(r.taglia || '—')}</td><td>${fmtIso(r.data)}</td><td>${fmtIso(r.scadenza)}</td><td>${stChip(r)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessuna consegna registrata.</td></tr>'}
    </tbody></table></div>
    <article class="card"><h2>Da ordinare</h2><p class="sub">Capi scaduti o in scadenza nei prossimi ${FINESTRA_SCAD} giorni</p>
      ${Object.keys(ordine).length ? `<ul style="margin:0;padding-left:18px;display:grid;gap:6px">${Object.entries(ordine).map(([k, n]) => `<li>${n} × ${esc(k)}</li>`).join('')}</ul>` : '<p class="empty">Niente da ordinare. ✓</p>'}</article></div>`;
}

// ---------- Statistiche ----------
function pStatistiche() {
  const m = S.month || monthNow(), p = monthParts(m);
  const rc = need('r:comuni:' + m, 'report', Object.assign({ tipo: 'comuni' }, p));
  const rd = need('r:dip:' + m, 'report', Object.assign({ tipo: 'dipendenti' }, p));
  const bars = (r, color) => {
    if (!r || r.error) return r && r.error ? errBox(r.error) : loadingBox('Preparo il report del mese…');
    const rows = (r.righe || []).map(x => ({ nome: x[0], ore: Number(x[5]) || 0 })).filter(x => match(x.nome)).sort((a, b) => b.ore - a.ore);
    const max = Math.max(1, ...rows.map(x => x.ore));
    return rows.length ? `<div class="rows">${rows.map((x, i) => `<div style="display:grid;gap:6px"><div class="row"><div class="txt"><b>${esc(cap(x.nome))}</b></div><span class="sub"><b style="color:var(--ink)">${fmtH(x.ore)}</b> h</span></div>
      <div class="meter"><i class="${color}" style="width:${x.ore / max * 100}%;${i === 0 && color !== 'lime' ? 'background:var(--accent-dark)' : ''}"></i></div></div>`).join('')}</div>
      <p class="sub">Totale ${fmtH(rows.reduce((s, x) => s + x.ore, 0))} h · turni chiusi + extra autorizzati</p>` : '<p class="empty">Nessun turno chiuso in questo mese.</p>';
  };
  return head(`<button class="btn" data-pdf="dipendenti">${icon('download')}PDF dipendenti</button><button class="btn ghost" data-pdf="comuni">${icon('download')}PDF per comune</button>`) +
    `<div class="toolbar"><label><span class="sr">Mese</span><input type="month" id="monthPick" value="${m}"></label>${S.demo ? '' : '<button class="btn plain sm" data-act="email">Invia il riepilogo per email</button>'}</div>
    <div class="grid g-2"><article class="card"><div class="card-head"><h2>Ore per cantiere</h2><small>${monthName(m)}</small></div>${bars(rc, '')}</article>
    <article class="card"><div class="card-head"><h2>Ore per dipendente</h2><small>${monthName(m)}</small></div>${bars(rd, 'lime')}</article></div>`;
}
async function downloadPdf(tipo, btn) {
  if (S.demo) return toast('Nella modalità prova il PDF non si scarica');
  const m = S.month || monthNow();
  btn.disabled = true; const t = btn.innerHTML; btn.textContent = 'Preparo il PDF…';
  try {
    const out = await queued('pdf', Object.assign({ tipo }, monthParts(m)));
    const bin = atob(out.base64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], out.nome || 'report.pdf', { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) await navigator.share({ files: [file], title: file.name }).catch(() => {});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  } catch (e) { const w = why(e); if (w) toast(w); }
  btn.disabled = false; btn.innerHTML = t;
}

// ---------- Dipendenti (visite e corsi) ----------
function scUltime(sc) {
  const m = {};
  sc.righe.forEach(r => { const k = r.operatore.toLowerCase() + '|' + r.voce.toLowerCase(); if (!m[k] || m[k].fatto < r.fatto) m[k] = r; });
  return Object.values(m);
}
function scVicine(sc) {
  const attivi = new Set((sc.operatori || []).filter(o => o.attivo !== false).map(o => o.nome.toLowerCase()));
  return scUltime(sc).filter(r => (!attivi.size || attivi.has(r.operatore.toLowerCase())) && r.scadenza && daysTo(r.scadenza) <= FINESTRA_SCAD).sort((a, b) => a.scadenza.localeCompare(b.scadenza));
}
const scTxt = r => { const g = daysTo(r.scadenza); return g === null ? 'senza scadenza' : g < 0 ? `scaduto da ${-g} g` : g === 0 ? 'scade oggi' : `scade tra ${g} g`; };
function pDipendenti() {
  const sc = needScad();
  if (!sc || sc.error) return head() + (sc && sc.error ? errBox(sc.error) : loadingBox());
  if (!Array.isArray(sc.voci)) return head() + errBox('Per visite e corsi va aggiornato lo script Google (guida nel repository).');
  const ult = scUltime(sc);
  const voci = sc.voci.filter(v => v.attiva && ult.some(r => sameName(r.voce, v.nome))).map(v => v.nome);
  const ops = (sc.operatori || []).filter(o => o.attivo !== false).map(o => o.nome).filter(n => match(n));
  const vic = scVicine(sc).filter(r => match(r.operatore, r.voce));
  const cell = (op, voce) => {
    const r = ult.find(x => sameName(x.operatore, op) && sameName(x.voce, voce));
    if (!r) return '<span class="small" style="color:#9a9a96">—</span>';
    const g = daysTo(r.scadenza);
    const cls = g === null ? '' : g < 0 ? 'no' : g <= FINESTRA_SCAD ? 'wait' : '';
    return cls ? chip(cls, fmtIso(r.scadenza)) : `${fmtIso(r.scadenza)}`;
  };
  return head(`<a class="btn ghost" href="${APP_URL}" target="_blank" rel="noopener">Registra visita o corso</a>`) +
    `<article class="card"><div class="card-head"><h2>In scadenza</h2><small>scaduti e nei prossimi ${FINESTRA_SCAD} giorni</small></div>
    <div class="rows">${vic.map(r => `<div class="row"><div class="ini c${daysTo(r.scadenza) < 0 ? 3 : 0}" aria-hidden="true">${esc(initials(r.operatore))}</div><div class="txt"><b>${esc(r.operatore)}</b><span>${esc(r.voce)} · ${fmtIso(r.scadenza)}</span></div>${chip(daysTo(r.scadenza) < 0 ? 'no' : 'wait', scTxt(r))}</div>`).join('') || '<p class="empty">Niente in scadenza. ✓</p>'}</div></article>
    <div class="table-box"><table><thead><tr><th>Dipendente</th>${voci.map(v => `<th>${esc(v.length > 22 ? v.slice(0, 20) + '…' : v)}</th>`).join('')}</tr></thead><tbody>
    ${ops.map(o => `<tr><td class="name">${esc(o)}</td>${voci.map(v => `<td>${cell(o, v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${voci.length + 1}" class="empty">Nessun dipendente.</td></tr>`}
    </tbody></table></div>`;
}

// ---------- Impostazioni ----------
function pImpostazioni() {
  return head() + `<div class="grid g-2">
    <article class="card"><h2>Link di invito</h2><p class="sub">Ogni operatore lo apre una volta sul suo telefono: da lì le sue timbrature vengono accettate. Non pubblicarlo nei gruppi aperti.</p>
      <button class="btn" data-act="invite">${icon('phone')}Prepara il link di invito</button></article>
    <article class="card"><h2>Password del responsabile</h2><p class="sub">La stessa dell'app Timbra Cantieri. Almeno 6 caratteri.</p>
      <form id="pwdForm" style="display:grid;gap:10px"><label class="field">Nuova password<input type="password" name="p1" minlength="6" required autocomplete="new-password"></label>
      <label class="field">Ripeti<input type="password" name="p2" minlength="6" required autocomplete="new-password"></label><button class="btn ghost" type="submit">Cambia password</button></form></article>
    <article class="card"><h2>Sull'iPhone</h2><p class="sub">Apri questa pagina in Safari, tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>: si apre a tutto schermo come un'app. Per sicurezza la password va reinserita ogni volta che la riapri.</p></article>
    <article class="card"><h2>App degli operatori</h2><p class="sub">Cantieri, sede, programma, consegne DPI e correzioni delle timbrature si gestiscono ancora dall'app Timbra Cantieri (5 tocchi sul logo per l'area responsabile).</p>
      <a class="btn ghost" href="${APP_URL}" target="_blank" rel="noopener">Apri Timbra Cantieri</a></article></div>`;
}
async function invite() {
  openDlg(`<h2>Link di invito</h2><p class="loading" id="invBox">Preparo il link…</p><div class="actions"><button class="btn plain" data-act="close">Chiudi</button></div>`);
  try {
    const out = await queued('codice');
    const box = $('#invBox'); if (!box) return;
    if (!out.codice) { box.textContent = 'Il codice di accesso non è ancora attivo: nello script esegui una volta "attivaCodiceAccesso".'; return; }
    const link = new URL(APP_URL, location.href).href + '?codice=' + out.codice;
    box.outerHTML = `<p class="sub">Mandalo a ogni operatore. Chi non ha il link non può timbrare né leggere niente.</p>
      <input class="field" readonly value="${esc(link)}" style="height:48px;border-radius:14px;border:1px solid #c9ccc2;padding:0 12px;font-size:15px;width:100%" onclick="this.select()">
      <div class="actions" style="justify-content:flex-start"><a class="btn" href="https://wa.me/?text=${encodeURIComponent('Apri questo link sul telefono per collegare l\'app Timbra Cantieri: ' + link)}" target="_blank" rel="noopener">Invia su WhatsApp</a>
      <button class="btn ghost" data-copy="${esc(link)}">Copia</button></div>`;
  } catch (e) { const box = $('#invBox'); if (box) box.textContent = why(e); }
}

// ---------- Finestra, avvisi ----------
const dlg = $('#dlg');
function openDlg(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); }
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
function moreMenu() {
  openDlg(`<h2>Menu</h2><div class="sheet-nav">${MENU.filter(v => !TABS.includes(v)).concat('impostazioni').map(v => `<button data-go="${v}">${icon(v)}${VIEWS[v][0]}${navBadge(v)}</button>`).join('')}
    <button data-act="logout">${icon('esci')}Esci</button></div><div class="actions"><button class="btn plain" data-act="close">Chiudi</button></div>`);
}

// ---------- Eventi ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-act],[data-tf],[data-if],[data-week],[data-foto],[data-assign],[data-reopen],[data-editint],[data-delint],[data-extra],[data-ass],[data-pdf],[data-copy]');
  if (!el) return;
  const d = el.dataset;
  if (d.go) return go(d.go);
  if (d.tf) { S.tFilter = d.tf; return renderPage(); }
  if (d.if) { S.iFilter = d.if; return renderPage(); }
  if (d.week) { S.week = d.week === '0' ? mondayOf(todayIso()) : addDays(S.week, Number(d.week)); return renderPage(); }
  if (d.foto) return showFoto(d.id, d.foto);
  if (d.assign) {
    const x = intById(d.assign), sel = document.querySelector(`[data-assign-sel="${CSS.escape(d.assign)}"]`);
    if (!x || !sel) return;
    el.disabled = true; el.textContent = 'Salvo…';
    return saveInt(Object.assign(intPayload(x), { assegnato: sel.value }), sel.value === 'Tutti' ? 'Assegnato a tutti' : `Assegnato a ${sel.value}`);
  }
  if (d.editint) return intForm(intById(d.editint));
  if (d.delint) {
    if (!confirm('Eliminare questo intervento?')) return;
    dlg.close();
    return queued('eliminaintervento', { id: d.delint }).then(out => { S.cache.interventi = out; toast('Intervento eliminato'); renderPage(); }, err => toast(why(err)));
  }
  if (d.reopen) return queued('riapriintervento', { id: d.reopen }).then(out => { S.cache.interventi = out; toast('Intervento riaperto'); renderPage(); }, err => toast(why(err)));
  if (d.extra) return decide('extra', d.extra, d.ok === '1', el);
  if (d.ass) return decide('ass', d.ass, d.ok === '1', el);
  if (d.pdf) return downloadPdf(d.pdf, el);
  if (d.copy) return navigator.clipboard.writeText(d.copy).then(() => toast('Link copiato'), () => toast('Copia non riuscita: tieni premuto sul link'));
  switch (d.act) {
    case 'demo': S.demo = true; S.pwd = null; return demoApi('leggi').then(enter);
    case 'logout': return logout();
    case 'refresh': return refresh();
    case 'more': return moreMenu();
    case 'close': return dlg.close();
    case 'invite': return invite();
    case 'newInt': if (!S.cache.interventi) needInt(); return intForm(null);
    case 'email': return queued('email', monthParts(S.month || monthNow())).then(() => toast('Riepilogo inviato per email'), err => toast(why(err)));
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'monthPick' && e.target.value) { S.month = e.target.value; renderPage(); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'pwdForm') return;
  e.preventDefault();
  const f = new FormData(e.target), p1 = String(f.get('p1')), p2 = String(f.get('p2'));
  if (p1 !== p2) return toast('Le due password non coincidono');
  if (S.demo) return toast('Nella modalità prova la password non cambia');
  queued('cambiapassword', { nuova: p1 }).then(() => { S.pwd = p1; e.target.reset(); toast('Password cambiata'); }, err => toast(why(err)));
});
// Tornando sull'app dopo un po', i dati si ricaricano
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if ((S.pwd || S.demo) && hiddenAt && Date.now() - hiddenAt > 5 * 60000) { S.cache = {}; renderPage(); }
});

// ---------- Modalità prova (dati finti, niente rete) ----------
let DEMO_DB = null;
function demoBuild() {
  const today = todayIso(), now = Date.now();
  const at = (iso, h, m) => { const d = dayOf(iso); d.setHours(h, m, 0, 0); return d.getTime(); };
  const ops = ['Mario Rossi', 'Luca Bianchi', 'Simone Pieri', 'Davide Fontana', 'Paolo Conti', 'Stefano Marchi', 'Fabio Lenzi', 'Nicola Vanni'];
  const sites = ['PONTEDERA', 'BIENTINA', 'CASCINA', 'CALCINAIA', 'ECOFOR SERVICE', 'ECOACCIAI'];
  const t = []; let n = 0;
  for (let k = 20; k >= 0; k--) {
    const iso = addDays(today, -k); const dow = dayOf(iso).getDay(); if (dow === 0) continue;
    ops.forEach((o, i) => {
      if ((i + k) % 4 === 3) return;
      const site = sites[i % sites.length], imp = impianto(site);
      const sh = imp ? (/ECOFOR/.test(site) ? 7 : 8) : (i % 3 === 2 ? 13 : 6);
      const start = at(iso, sh, (i * 3) % 9);
      if (start > now) return;
      const dur = (imp ? 8 : 5) * 36e5 + ((i + k) % 5 === 0 ? 25 * 60000 : 0);
      const end = k === 0 && start + dur > now ? null : start + dur;
      t.push({ id: 'dt' + (n++), dip: o, cantiere: site, start, end, extra: end && dur > (imp ? 8 : 5) * 36e5 ? 25 : 0, statoExtra: end && dur > (imp ? 8 : 5) * 36e5 ? (k < 2 ? 'Da autorizzare' : 'Autorizzato') : '',
        posIn: '', posOut: '', turno: sh >= 13 ? 'Pomeriggio' : 'Mattina', sede: k === 0 && i === 3 ? 'FUORI SEDE (1,2 km)' : 'IN SEDE', ritardo: 0, tolti: (i + k) % 7 === 0 ? 15 : 0 });
    });
  }
  const mon = mondayOf(today);
  const squadre = [];
  for (let i = 0; i < 6; i++) {
    const d = addDays(mon, i);
    squadre.push({ id: 'ds' + i + 'a', data: d, turno: 'Mattina', cantiere: 'PONTEDERA', operatori: [ops[0], ops[5]] });
    squadre.push({ id: 'ds' + i + 'b', data: d, turno: 'Mattina', cantiere: 'BIENTINA', operatori: [ops[1]] });
    squadre.push({ id: 'ds' + i + 'c', data: d, turno: 'Pomeriggio', cantiere: 'CASCINA', operatori: [i === 2 ? ops[6] : ops[3]] });
    if (i < 5) squadre.push({ id: 'ds' + i + 'd', data: d, turno: 'Mattina', cantiere: 'ECOFOR SERVICE', operatori: [ops[4]] });
    if (i < 5) squadre.push({ id: 'ds' + i + 'e', data: d, turno: 'Mattina', cantiere: 'ECOACCIAI', operatori: [ops[2]] });
  }
  squadre.push({ id: 'dsf', data: addDays(mon, 3), turno: 'Ferie', cantiere: '', operatori: [ops[7]] });
  const operatori = ops.map((o, i) => ({ nome: o, attivo: true, ore: i === 2 || i === 4 ? 40 : 30, fisso: '' }));
  return {
    t, squadre, operatori,
    extra: t.filter(x => x.statoExtra === 'Da autorizzare').map(x => Object.assign({}, x, { motivo: ['Guasto del mezzo', 'Foratura', 'Traffico per incidente'][x.id.length % 3], nota: '' })),
    assenze: [
      { id: 'da1', dip: ops[3], tipo: 'Ferie', dal: addDays(today, 10), al: addDays(today, 14), giorni: 5, ore: 0, nota: '', stato: 'Da approvare' },
      { id: 'da2', dip: ops[5], tipo: 'Permesso', dal: addDays(today, 3), al: addDays(today, 3), giorni: 0, ore: 2, nota: 'visita', stato: 'Da approvare' },
      { id: 'da3', dip: ops[7], tipo: 'Ferie', dal: addDays(mon, 3), al: addDays(mon, 3), giorni: 1, ore: 0, nota: '', stato: 'Approvata' }],
    interventi: [
      { id: 'di1', data: today, cliente: 'Maria Bianchi', indirizzo: 'Via Roma 12', localita: 'Pontedera', coord: '', cosa: 'Divano 3 posti e 2 sedie', note: 'Citofono Bianchi', assegnato: 'Tutti', stato: 'Da fare', screenshot: false, fotoPrima: false, fotoDopo: false },
      { id: 'di2', data: today, cliente: '', indirizzo: 'Via della Repubblica 3', localita: 'Bientina', coord: '', cosa: 'Frigorifero', note: '', assegnato: ops[1], stato: 'Da fare', screenshot: false, fotoPrima: false, fotoDopo: false },
      { id: 'di3', data: addDays(today, -1), cliente: 'Anna Verdi', indirizzo: 'Piazza Garibaldi 8', localita: 'Cascina', coord: '', cosa: 'Materasso e rete', note: '', assegnato: ops[3], stato: 'Fatto', fattoIl: now - 864e5, fattoDa: ops[3], notaOp: 'Ritirato anche un mobiletto', screenshot: false, fotoPrima: false, fotoDopo: false, posChiusura: '' },
      { id: 'di4', data: addDays(today, -2), cliente: '', indirizzo: 'Via Tosco Romagnola 210', localita: 'Pontedera', coord: '', cosa: 'Armadio', note: '', assegnato: ops[0], stato: 'Fatto', fattoIl: now - 2 * 864e5, fattoDa: ops[0], notaOp: '', screenshot: false, fotoPrima: false, fotoDopo: false, posChiusura: '' }],
    scad: { voci: [{ nome: 'Visita medica', cat: 'Sanitaria', mesi: 12, attiva: true }, { nome: 'Primo soccorso', cat: 'Formazione', mesi: 36, attiva: true }, { nome: 'Antincendio', cat: 'Formazione', mesi: 60, attiva: true }, { nome: 'Preposto', cat: 'Formazione', mesi: 24, attiva: true }],
      righe: ops.flatMap((o, i) => [
        { id: 'sv' + i, operatore: o, voce: 'Visita medica', fatto: addDays(today, -340 + i * 40), scadenza: addDays(today, 25 + i * 40), note: '' },
        { id: 'sp' + i, operatore: o, voce: 'Primo soccorso', fatto: addDays(today, -900 + i * 30), scadenza: addDays(today, 195 + i * 30 - (i === 2 ? 300 : 0)), note: '' }]
        .concat(i % 3 === 0 ? [{ id: 'sa' + i, operatore: o, voce: 'Antincendio', fatto: addDays(today, -400), scadenza: addDays(today, 1400), note: '' }] : [])), operatori },
    dpi: { capi: [], taglie: {}, operatori, consegne: ops.flatMap((o, i) => [
      { id: 'dc' + i, data: addDays(today, -200 - i * 20), operatore: o, capo: 'Scarpe S3', taglia: String(41 + (i % 4)), qta: 1, scadenza: addDays(today, 165 - i * 25), note: '' },
      { id: 'dg' + i, data: addDays(today, -150), operatore: o, capo: 'Guanti anti-taglio', taglia: 'L', qta: 2, scadenza: addDays(today, 30 - i * 6), note: '' }]) }
  };
}
async function demoApi(azione, x) {
  if (!DEMO_DB) DEMO_DB = demoBuild();
  const D = DEMO_DB;
  await new Promise(r => setTimeout(r, 120));
  const ok = o => Object.assign({ ok: true }, o);
  const cantieri = ['PONTEDERA', 'BIENTINA', 'CASCINA', 'CALCINAIA', 'ECOFOR SERVICE', 'ECOACCIAI'].map(n => ({ nome: n, attivo: true }));
  switch (azione) {
    case 'leggi': return ok({ cantieri, extraInAttesa: D.extra.length, assenzeInAttesa: D.assenze.filter(a => a.stato === 'Da approvare').length });
    case 'timbrature': return ok({ timbrature: D.t.filter(t => { const d = new Date(t.start); return d.getFullYear() === x.anno && d.getMonth() === x.mese; }).sort((a, b) => b.start - a.start), cantieri });
    case 'programma': return ok({ squadre: D.squadre.filter(s => s.data >= x.da && s.data <= x.a), operatori: D.operatori, cantieri });
    case 'extra': return ok({ extra: D.extra });
    case 'decidi': D.extra = D.extra.filter(e => e.id !== x.id); return ok({ extra: D.extra });
    case 'assenze': return ok({ assenze: D.assenze });
    case 'decidiassenza': D.assenze.forEach(a => { if (a.id === x.id) a.stato = x.approva ? 'Approvata' : 'Rifiutata'; }); return ok({ assenze: D.assenze });
    case 'interventi': return ok({ interventi: D.interventi, operatori: D.operatori });
    case 'salvaintervento': {
      const it = x.intervento, old = D.interventi.find(i => i.id === it.id);
      if (old) Object.assign(old, it); else D.interventi.unshift(Object.assign({ id: 'dn' + Date.now(), stato: 'Da fare', screenshot: false, fotoPrima: false, fotoDopo: false }, it));
      return ok({ interventi: D.interventi, operatori: D.operatori });
    }
    case 'eliminaintervento': D.interventi = D.interventi.filter(i => i.id !== x.id); return ok({ interventi: D.interventi, operatori: D.operatori });
    case 'riapriintervento': D.interventi.forEach(i => { if (i.id === x.id) { i.stato = 'Da fare'; i.fattoDa = ''; i.fattoIl = null; } }); return ok({ interventi: D.interventi, operatori: D.operatori });
    case 'scad': return ok(D.scad);
    case 'dpi': return ok(D.dpi);
    case 'codice': return ok({ codice: 'PROVA1234' });
    case 'report': {
      const per = {};
      D.t.filter(t => t.end && new Date(t.start).getMonth() === x.mese).forEach(t => { const k = x.tipo === 'comuni' ? t.cantiere : t.dip; per[k] = (per[k] || 0) + oreTurno(t.cantiere) - t.tolti / 60; });
      return ok({ righe: Object.entries(per).map(([k, v]) => [k, 0, 0, v, 0, Math.round(v * 100) / 100]) });
    }
    default: return ok({});
  }
}

// ---------- Avvio ----------
renderLogin();
