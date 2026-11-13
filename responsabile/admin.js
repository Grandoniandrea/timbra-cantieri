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
function refresh() { if (S.plan && S.plan.dirty && !confirm('Ricaricare e perdere le modifiche al programma?')) return; S.plan = null; S.cache = {}; renderPage(); toast('Aggiorno i dati…'); }
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
function logout(msg) { DEMO_DB = null; S.plan = null; S.pwd = null; S.demo = false; S.cache = {}; dlg.close(); renderLogin(msg); }

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
function go(v) {
  if (S.plan && S.plan.dirty && v !== S.view && S.view === 'programma' && !confirm('Ci sono modifiche non salvate al programma. Uscire e perderle?')) return;
  if (S.plan && S.plan.dirty && v !== 'programma') S.plan = null;
  S.view = v; dlg.close(); window.scrollTo(0, 0); renderPage(); }

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
  const sq = pl && pl.squadre ? pl.squadre.concat(autoFissi(pl.squadre, pl.operatori, mon)).filter(s => s.data === today && !ASSENZE.includes(s.turno)) : null;
  const oggi = `<article class="card"><div class="card-head"><h2>Cantieri di oggi</h2><button class="btn ghost sm" data-go="programma">Programma</button></div>
    <div class="rows">${sq === null ? (pl && pl.error ? errBox(pl.error) : loadingBox()) : sq.length ? sq.slice(0, 6).map(s => `<div class="row"><span class="pin ${impianto(s.cantiere) ? '' : 'g'}">${icon('interventi')}</span>
      <div class="txt"><b>${esc(impiantoDi(s.cantiere) ? impiantoDi(s.cantiere).nome : cap(s.cantiere))}</b><span>${esc(s.turno)}${turnoOrario(s.turno, s.cantiere)} · ${esc(s.operatori.join(', '))}</span></div></div>`).join('') + (sq.length > 6 ? `<p class="sub">e altre ${sq.length - 6} squadre</p>` : '')
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
    ${rows.map(t => `<tr data-tedit="${esc(t.id)}"><td>${fmtDay(t.start)}</td><td class="name"><button class="link" data-tedit="${esc(t.id)}" style="color:var(--ink);text-decoration:none">${esc(t.dip)}</button></td><td>${esc(cap(t.cantiere))}<span class="small">${esc(t.turno || '')}</span></td>
      <td>${fmtTime(t.start)}${t.tolti ? `<span class="small" style="color:#9a4a05">ritardo −${t.tolti} min</span>` : ''}</td><td>${t.end ? fmtTime(t.end) : '—'}</td><td>${t.end ? fmtDur(t.end - t.start) : fmtDur(Date.now() - t.start)}</td>
      <td>${esc(cap(t.sede) || '—')}${isMap(t.posIn) ? ` <a href="${esc(t.posIn.split(' ')[0])}" target="_blank" rel="noopener">mappa</a>` : ''}</td>
      <td>${t.extra ? `+${t.extra} min<span class="small">${esc(t.statoExtra)}</span>` : '—'}</td><td>${statoTimbratura(t)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nessuna timbratura con questi filtri.</td></tr>'}
    </tbody></table></div>
    <p class="foot">Tocca una timbratura per correggere orari o cantiere, o per eliminarla.</p>`;
  }
  return head() + tools + body;
}

// ---------- Programma (modificabile) ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isAss = t => ASSENZE.includes(t);
const IMPIANTI = [{ id: 'ECOFOR SERVICE', nome: 'Ecofor Service', orario: '07–15:30' }, { id: 'ECOACCIAI', nome: 'Ecoacciai', orario: '08–16' }];
const impiantoDi = c => { const n = String(c || '').toUpperCase(); return /ECOFOR/.test(n) ? IMPIANTI[0] : /ECOACCIAI|ECO ACCIAI/.test(n) ? IMPIANTI[1] : null; };
const feriale = iso => { const g = dayOf(iso).getDay(); return g >= 1 && g <= 5; };
// Gli operatori con un impianto fisso ci lavorano dal lunedì al venerdì anche se non sono in una squadra:
// compaiono da soli nel programma (non si salvano), salvo assenze o un'altra squadra quel giorno.
function autoFissi(squadre, operatori, da) {
  const out = [];
  (operatori || []).filter(o => o.attivo !== false && impiantoDi(o.fisso)).forEach(o => {
    for (let i = 0; i < 7; i++) {
      const d = addDays(da, i);
      if (!feriale(d)) continue;
      if (squadre.some(s => s.data === d && s.operatori.some(x => sameName(x, o.nome)))) continue;
      out.push({ id: 'auto-' + o.nome + '-' + d, data: d, turno: 'Impianto', cantiere: o.fisso, operatori: [o.nome], nota: '', auto: true });
    }
  });
  return out;
}
const conFissi = P => P.squadre.concat(autoFissi(P.squadre, P.operatori, P.week));
const clone = o => JSON.parse(JSON.stringify(o));
function planReady(w) {
  if (S.plan && S.plan.week === w) return S.plan;
  const pl = needWeek(w);
  if (!pl || pl.error) return pl;
  S.plan = { week: w, squadre: clone(pl.squadre || []), operatori: pl.operatori || [], cantieri: (pl.cantieri || []).filter(c => c.attivo !== false), dirty: false };
  return S.plan;
}
const oreContratto = nome => { const o = S.plan && S.plan.operatori.find(p => sameName(p.nome, nome)); return o && Number(o.ore) > 0 ? Number(o.ore) : 30; };
function oreSett(squadre) {
  const m = {};
  squadre.forEach(s => s.operatori.forEach(o => {
    const k = o.trim().toLowerCase(); const x = m[k] || (m[k] = { nome: o, h: 0 });
    x.h += isAss(s.turno) ? ORE_GEOFOR : oreTurno(s.cantiere);
  }));
  return m;
}
function doppiDi(squadre) {
  const m = {};
  squadre.filter(s => !isAss(s.turno)).forEach(s => s.operatori.forEach(o => { const k = s.data + '|' + o.toLowerCase(); (m[k] = m[k] || new Set()).add(s.turno); }));
  return (d, n) => (m[d + '|' + String(n).toLowerCase()] || new Set()).size > 1;
}
const siteColor = n => ((S.plan && S.plan.cantieri.find(c => c.nome === n)) || S.cantieri.find(c => c.nome === n) || {}).colore || 'var(--accent)';
function changeWeek(w) {
  if (S.plan && S.plan.dirty && !confirm('Ci sono modifiche non salvate al programma. Cambiare settimana e perderle?')) return;
  if (S.plan && S.plan.dirty) S.plan = null;
  S.week = w; renderPage();
}
function pProgramma() {
  const w = S.week || mondayOf(todayIso());
  const P = planReady(w);
  const days = [...Array(7)].map((_, i) => addDays(w, i));
  const today = todayIso();
  const tools = `<div class="toolbar weeknav">
    <button class="icon-btn" data-week="-7" aria-label="Settimana precedente">${icon('left')}</button>
    <b>Dal ${dayOf(w).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} al ${dayOf(days[6]).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</b>
    <button class="icon-btn" data-week="7" aria-label="Settimana successiva">${icon('right')}</button>
    ${w !== mondayOf(today) ? '<button class="btn plain sm" data-week="0">Oggi</button>' : ''}</div>`;
  const actions = `<button class="btn ghost" data-act="copyPrev">Copia settimana prima</button><button class="btn ghost" data-act="ops">${icon('dipendenti')}Operatori</button><button class="btn plain" data-act="printPlan">Stampa</button>`;
  if (!P || P.error) return head(actions) + tools + (P && P.error ? errBox(P.error) : loadingBox());
  const all = conFissi(P);
  const isD = doppiDi(all);
  const hit = s => match(s.cantiere, s.operatori.join(' '), s.turno);
  const dayHtml = d => {
    const ass = P.squadre.filter(s => s.data === d && isAss(s.turno));
    return `<section class="day ${d === today ? 'is-today' : ''}"><h3>${dayOf(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
      ${TURNI.map(t => `<div class="turno"><small>${t.nome} ${t.orario}</small>
        ${P.squadre.filter(s => s.data === d && s.turno === t.nome && !impiantoDi(s.cantiere)).map(s => `<button class="sqb ${hit(s) ? '' : 'dim'}" data-sq="${esc(s.id)}">
          <i style="background:${esc(siteColor(s.cantiere))}"></i><span><b>${esc(cap(s.cantiere))}</b> ${s.operatori.map(o => `<span class="${isD(d, o) ? 'doppio' : ''}">${esc(o)}</span>`).join(', ')}${s.nota ? `<em>${esc(s.nota)}</em>` : ''}</span></button>`).join('')}
        <button class="addsq" data-addsq="${d}|${t.nome}">+ Squadra</button></div>`).join('')}
      <div class="turno"><small>Impianti · Ecofor 07–15:30 · Ecoacciai 08–16</small>
        ${all.filter(s => s.data === d && !isAss(s.turno) && impiantoDi(s.cantiere)).map(s => s.auto
          ? `<div class="sqb fisso ${hit(s) ? '' : 'dim'}"><i style="background:${esc(siteColor(s.cantiere))}"></i><span><b>${esc(impiantoDi(s.cantiere).nome)}</b> <span class="${isD(d, s.operatori[0]) ? 'doppio' : ''}">${esc(s.operatori[0])}</span><em>cantiere fisso</em></span></div>`
          : `<button class="sqb ${hit(s) ? '' : 'dim'}" data-sq="${esc(s.id)}"><i style="background:${esc(siteColor(s.cantiere))}"></i><span><b>${esc(impiantoDi(s.cantiere).nome)}</b> ${s.operatori.map(o => `<span class="${isD(d, o) ? 'doppio' : ''}">${esc(o)}</span>`).join(', ')}${s.nota ? `<em>${esc(s.nota)}</em>` : ''}</span></button>`).join('')}
        <button class="addsq" data-addsq="${d}|Impianto">+ Squadra impianto</button></div>
      <button class="assb ${ass.length ? 'on' : ''}" data-assday="${d}">${ass.length ? ass.map(a => `<b>${esc(a.turno)}:</b> ${esc(a.operatori.join(', '))}`).join('<br>') : '+ Ferie, malattia, permesso'}</button>
    </section>`;
  };
  const ore = oreSett(all);
  const names = new Map(); P.operatori.filter(o => o.attivo !== false).forEach(o => names.set(o.nome.toLowerCase(), o.nome)); Object.values(ore).forEach(x => { if (!names.has(x.nome.toLowerCase())) names.set(x.nome.toLowerCase(), x.nome); });
  const box = [...names.values()].map(n => { const h = (ore[n.toLowerCase()] || { h: 0 }).h, max = oreContratto(n), d = h - max; return { nome: n, h, max, d, st: d > 0 ? 'over' : d < 0 ? 'under' : 'ok' }; })
    .filter(r => match(r.nome)).sort((a, b) => ({ over: 0, under: 1, ok: 2 })[a.st] - ({ over: 0, under: 1, ok: 2 })[b.st] || a.nome.localeCompare(b.nome));
  const lbl = { over: ['no', 'sfora'], under: ['wait', 'sotto'], ok: ['ok', 'in regola'] };
  const spec = `<article class="card"><div class="card-head"><h2>Specchietto ore</h2><small>programma contro contratto</small></div>
    <div class="rows">${box.map(r => `<div style="display:grid;gap:6px"><div class="row"><div class="txt"><b>${esc(r.nome)}</b></div><span class="sub"><b style="color:var(--ink)">${fmtH(r.h)}</b>/${fmtH(r.max)} h${r.d ? ` · ${r.d > 0 ? '+' : '−'}${fmtH(Math.abs(r.d))}` : ''}</span>${chip(lbl[r.st][0], lbl[r.st][1])}</div>
      <div class="meter"><i class="${r.st === 'ok' ? '' : r.st}" style="width:${Math.min(100, r.max ? r.h / r.max * 100 : 0)}%"></i></div></div>`).join('') || '<p class="empty">Nessun operatore: aggiungili da Operatori.</p>'}</div>
    <p class="sub">Geofor 5 h a turno, Ecofor Service ed Ecoacciai 8 h. Ferie, malattia e permesso contano 5 h. Chi ha un impianto fisso (da Operatori) ci compare da solo dal lunedì al venerdì. <span class="doppio">Nome in rosso</span> = doppio turno.</p></article>`;
  const save = `<div class="savebar ${P.dirty ? 'show' : ''}"><span>${P.dirty ? 'Modifiche non salvate' : 'Programma salvato'}</span>
    ${P.dirty ? '<button class="btn plain sm" data-act="undoPlan">Annulla</button>' : ''}<button class="btn sm" data-act="savePlan" ${P.dirty ? '' : 'disabled'}>Salva il programma</button></div>`;
  return head(actions) + tools + save + `<div class="days">${days.map(dayHtml).join('')}</div>` + `<div class="grid g-2">${spec}</div>`;
}
function sqEdit(id, data, turno) {
  const P = S.plan; if (!P) return;
  const s = id ? P.squadre.find(x => x.id === id) : { id: uid(), data, turno, cantiere: '', operatori: [], nota: '' };
  if (!s) return;
  const imp = s.turno === 'Impianto' || !!impiantoDi(s.cantiere);
  let names = P.cantieri.map(c => c.nome).filter(n => !!impiantoDi(n) === imp);
  if (imp && !names.length) names = IMPIANTI.map(x => x.id);
  if (s.cantiere && !names.includes(s.cantiere)) names.push(s.cantiere);
  const def = s.cantiere || names[0] || '';
  const altrove = (n, stesso) => P.squadre.some(x => x.id !== s.id && !isAss(x.turno) && x.data === s.data && (x.turno === s.turno) === stesso && x.operatori.some(o => sameName(o, n)));
  const inAss = n => (P.squadre.find(x => isAss(x.turno) && x.data === s.data && x.operatori.some(o => sameName(o, n))) || {}).turno;
  const ore = oreSett(conFissi(P).filter(x => x.id !== s.id));
  const people = P.operatori.filter(p => p.attivo !== false || s.operatori.some(o => sameName(o, p.nome)));
  const t = TURNI.find(x => x.nome === s.turno) || (imp ? { nome: 'Impianto', orario: 'Ecofor 07–15:30 · Ecoacciai 08–16' } : { nome: s.turno, orario: '' });
  openDlg(`<form id="sqForm" style="display:grid;gap:12px">
    <h2>${id ? 'Modifica squadra' : 'Nuova squadra'}</h2><p class="sub">${esc(dayOf(s.data).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(t.nome)} ${esc(t.orario)}</p>
    <label class="field">Cantiere<select name="cantiere">${names.map(n => `<option value="${esc(n)}" ${n === def ? 'selected' : ''}>${esc(cap(n))}</option>`).join('')}</select></label>
    ${people.length ? [0, 1, 2, 3].map(i => `<label class="field">Operatore ${i + 1}${i ? ' (facoltativo)' : ''}<select name="op"><option value="">${i ? '—' : 'Scegli…'}</option>
      ${people.map(p => { const x = ore[p.nome.toLowerCase()] || { h: 0 }; const a = inAss(p.nome);
        return `<option value="${esc(p.nome)}" ${s.operatori[i] && sameName(s.operatori[i], p.nome) ? 'selected' : ''}>${esc(p.nome)} · ${fmtH(x.h)}/${fmtH(oreContratto(p.nome))} h${a ? ' · IN ' + a.toUpperCase() : altrove(p.nome, true) ? ' · già in squadra' : altrove(p.nome, false) ? ' · doppio turno' : ''}</option>`; }).join('')}</select></label>`).join('') : '<p class="empty">Nessun operatore: aggiungili da Operatori.</p>'}
    <label class="field">Nota (facoltativa)<input name="nota" maxlength="200" value="${esc(s.nota || '')}" placeholder="es. mezzo, indirizzo, corso"></label>
    <div class="actions">${id ? '<button type="button" class="btn plain" data-act="delSq">Elimina</button>' : ''}<button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">OK</button></div></form>`);
  $('#sqForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target), ops = [...new Set(f.getAll('op').map(String).filter(Boolean))];
    if (!ops.length) return toast('Scegli almeno un operatore');
    Object.assign(s, { cantiere: String(f.get('cantiere') || def), operatori: ops, nota: String(f.get('nota') || '').trim() });
    if (!id) P.squadre.push(s);
    P.dirty = true; dlg.close(); renderPage();
  });
  const del = $('[data-act="delSq"]');
  if (del) del.addEventListener('click', ev => { ev.stopPropagation(); P.squadre = P.squadre.filter(x => x.id !== s.id); P.dirty = true; dlg.close(); renderPage(); });
}
function assEdit(d) {
  const P = S.plan; if (!P) return;
  const tipoDi = (n, g) => (P.squadre.find(x => x.data === (g || d) && isAss(x.turno) && x.operatori.some(o => sameName(o, n))) || {}).turno || '';
  const occupato = n => P.squadre.some(x => x.data === d && !isAss(x.turno) && x.operatori.some(o => sameName(o, n)));
  const people = P.operatori.filter(p => p.attivo !== false || tipoDi(p.nome));
  const fine = [...Array(7)].map((_, i) => addDays(P.week, i)).filter(x => x >= d);
  openDlg(`<form id="assForm" style="display:grid;gap:12px"><h2>Ferie, malattia, permesso</h2>
    <p class="sub">${esc(dayOf(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))} · ogni assenza conta 5 ore</p>
    <div class="rows">${people.map((p, i) => `<div class="row"><div class="txt"><b>${esc(p.nome)}</b>${occupato(p.nome) ? '<span>in squadra quel giorno</span>' : ''}</div>
      <label class="sr" for="as${i}">Assenza di ${esc(p.nome)}</label><select id="as${i}" name="as${i}" style="height:40px;border-radius:12px;border:1px solid #c9ccc2;padding:0 10px;background:#fff;font-size:16px">
      <option value="">—</option>${ASSENZE.map(a => `<option ${tipoDi(p.nome) === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div>`).join('') || '<p class="empty">Nessun operatore.</p>'}</div>
    ${fine.length > 1 ? `<label class="field">Vale per<select name="fino">${fine.map((x, k) => `<option value="${x}">${k ? `fino a ${dayOf(x).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric' })} (${k + 1} giorni)` : 'solo questo giorno'}</option>`).join('')}</select></label>` : ''}
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">OK</button></div></form>`);
  $('#assForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target), scelta = {};
    people.forEach((p, i) => { scelta[p.nome] = String(f.get('as' + i) || ''); });
    const cambiati = people.filter(p => scelta[p.nome] !== tipoDi(p.nome)).map(p => p.nome);
    const fino = String(f.get('fino') || d);
    fine.filter(x => x <= fino).forEach((g, k) => {
      const nuovo = {}; people.forEach(p => { nuovo[p.nome] = k === 0 || cambiati.includes(p.nome) ? scelta[p.nome] : tipoDi(p.nome, g); });
      const vecchi = P.squadre.filter(x => x.data === g && isAss(x.turno));
      const fuori = vecchi.map(x => ({ turno: x.turno, ops: x.operatori.filter(o => !people.some(p => sameName(p.nome, o))) }));
      P.squadre = P.squadre.filter(x => !(x.data === g && isAss(x.turno)));
      ASSENZE.forEach(a => {
        const ops = people.filter(p => nuovo[p.nome] === a).map(p => p.nome).concat((fuori.find(x => x.turno === a) || { ops: [] }).ops);
        const prima = vecchi.find(x => x.turno === a);
        if (ops.length) P.squadre.push({ id: prima ? prima.id : uid(), data: g, turno: a, cantiere: a.toUpperCase(), operatori: ops, nota: '' });
      });
    });
    P.dirty = true; dlg.close(); renderPage();
  });
}
async function savePlan(btn) {
  const P = S.plan; if (!P) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }
  try {
    const out = await queued('salvaprogramma', { da: P.week, a: addDays(P.week, 6), squadre: P.squadre });
    S.cache['p:' + P.week] = out;
    S.plan = { week: P.week, squadre: clone(out.squadre || P.squadre), operatori: out.operatori || P.operatori, cantieri: (out.cantieri || P.cantieri).filter(c => c.attivo !== false), dirty: false };
    toast('Programma salvato: gli operatori lo vedono sul telefono');
  } catch (e) { const w = why(e); if (w) toast(w); }
  renderPage();
}
async function copyPrev() {
  const P = S.plan; if (!P) return;
  const prev = addDays(P.week, -7);
  toast('Copio la settimana prima…');
  try {
    const out = await queued('programma', { da: prev, a: addDays(prev, 6) });
    const src = out.squadre || [];
    if (!src.length) return toast('La settimana prima è vuota');
    if (P.squadre.length && !confirm('Sostituire il programma di questa settimana con quello della settimana prima?')) return;
    P.squadre = src.map(s => Object.assign({}, s, { id: uid(), data: addDays(s.data, 7) }));
    P.dirty = true; renderPage(); toast('Copiata: controlla e salva');
  } catch (e) { const w = why(e); if (w) toast(w); }
}
// Operatori: attivi, ore da contratto, cantiere fisso, nuovi
async function opsEdit() {
  let ops = S.plan ? S.plan.operatori : null, sites = S.plan ? S.plan.cantieri : S.cantieri.filter(c => c.attivo !== false);
  if (!ops) {
    toast('Carico gli operatori…');
    try { const w = mondayOf(todayIso()); const out = await queued('programma', { da: w, a: w }); ops = out.operatori || []; sites = (out.cantieri || sites).filter(c => c.attivo !== false); }
    catch (e) { const w = why(e); if (w) toast(w); return; }
  }
  openDlg(`<form id="opsForm" style="display:grid;gap:12px"><h2>Operatori</h2>
    <p class="sub">Chi è spuntato compare nel programma. Le ore sono quelle settimanali da contratto. Chi ha un cantiere fisso trova subito quello nell'app.</p>
    <div class="rows">${ops.map((p, i) => `<div style="display:grid;gap:8px;padding:10px 0;border-top:1px solid var(--line-soft)">
      <div class="row"><label style="display:flex;gap:10px;align-items:center;flex:1;font-weight:600"><input type="checkbox" name="on" value="${i}" ${p.attivo !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">${esc(p.nome)}</label>
      <label style="display:flex;gap:6px;align-items:center;font-size:14px"><input name="ore${i}" inputmode="decimal" value="${esc(p.ore || 30)}" aria-label="Ore settimanali di ${esc(p.nome)}" style="width:56px;height:38px;border-radius:10px;border:1px solid #c9ccc2;text-align:center;font-size:16px"> h/sett.</label></div>
      <select name="fisso${i}" aria-label="Cantiere fisso di ${esc(p.nome)}" style="height:40px;border-radius:12px;border:1px solid #c9ccc2;padding:0 10px;background:#fff;font-size:15px"><option value="">Nessun cantiere fisso (va dove serve)</option>
      ${sites.map(c => c.nome).concat(p.fisso && !sites.some(c => c.nome === p.fisso) ? [p.fisso] : []).map(n => `<option value="${esc(n)}" ${n === p.fisso ? 'selected' : ''}>Fisso: ${esc(cap(n))}</option>`).join('')}</select></div>`).join('')}</div>
    <label class="field">Aggiungi operatori (uno per riga)<textarea name="nuovo" placeholder="es. Mario Rossi"></textarea></label>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#opsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), on = new Set(f.getAll('on').map(Number));
    const lista = ops.map((p, i) => ({ nome: p.nome, attivo: on.has(i), ore: Number(String(f.get('ore' + i) || '').replace(',', '.')) || 30, fisso: String(f.get('fisso' + i) || '') }));
    String(f.get('nuovo') || '').split(/[\n,;]+/).map(v => cap(v.trim().replace(/\s+/g, ' '))).filter(Boolean).forEach(n => { if (!lista.some(p => sameName(p.nome, n))) lista.push({ nome: n, attivo: true, ore: 30, fisso: '' }); });
    dlg.close(); toast('Salvo gli operatori…');
    try {
      const out = await queued('operatori', { operatori: lista });
      if (S.plan) S.plan.operatori = out.operatori || lista;
      Object.keys(S.cache).filter(k => k.startsWith('p:') || ['interventi', 'scad', 'dpi'].includes(k)).forEach(k => { if (!(S.plan && S.plan.dirty && k === 'p:' + S.plan.week)) delete S.cache[k]; });
      toast('Operatori salvati');
    } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
// Sull'iPhone la finestra di stampa si apre dopo: la pagina da stampare resta pronta finché non si chiude
function endPrint() { document.body.classList.remove('printing'); $('#printArea').innerHTML = ''; }
window.addEventListener('afterprint', endPrint);
function printDoc(html) {
  $('#printArea').innerHTML = html;
  document.body.classList.add('printing');
  const imgs = [...document.querySelectorAll('#printArea img')];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; setTimeout(ok, 2500); }))).then(() => setTimeout(() => window.print(), 100));
}
function printPlan() {
  const P = S.plan; if (!P) return;
  const days = [...Array(7)].map((_, i) => addDays(P.week, i)), all = conFissi(P), isD = doppiDi(all);
  const cell = (d, t) => all.filter(s => s.data === d && (t === 'Impianto' ? !isAss(s.turno) && impiantoDi(s.cantiere) : s.turno === t && !impiantoDi(s.cantiere))).map(s => `<div><b>${esc(impiantoDi(s.cantiere) ? impiantoDi(s.cantiere).nome : cap(s.cantiere))}</b>: ${s.operatori.map(o => isD(d, o) ? `<span style="color:#b42318;font-weight:700">${esc(o)}</span>` : esc(o)).join(', ')}</div>`).join('');
  printDoc(`<div class="pdoc"><div class="pdoc-h"><img src="../logo.png" alt="GE3CO"><div><h1>Programma della settimana</h1><p>Dal ${fmtIso(P.week)} al ${fmtIso(days[6])}</p></div></div>
    <table><thead><tr><th>Giorno</th><th>Mattina 06–11</th><th>Pomeriggio 13–18</th><th>Impianti</th><th>Assenze</th></tr></thead><tbody>
    ${days.map(d => `<tr><td><b>${dayOf(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' })}</b></td><td>${cell(d, 'Mattina')}</td><td>${cell(d, 'Pomeriggio')}</td><td>${cell(d, 'Impianto')}</td><td>${ASSENZE.map(a => cell(d, a) ? `<div><b>${a}</b>: ${P.squadre.filter(s => s.data === d && s.turno === a).map(s => esc(s.operatori.join(', '))).join(', ')}</div>` : '').join('')}</td></tr>`).join('')}
    </tbody></table><p>In rosso: doppio turno.</p></div>`);
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
    <label class="field">Screenshot della segnalazione${x.screenshot ? ' (già allegato: scegline uno per sostituirlo)' : ' (facoltativo)'}<input type="file" name="shot" accept="image/*" style="height:auto;padding:10px"></label>
    <div class="actions">${x.id ? '<button type="button" class="btn plain" data-delint="' + esc(x.id) + '">Elimina</button>' : ''}<button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#intForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const y = Object.assign(intPayload(x), Object.fromEntries(['indirizzo', 'localita', 'data', 'cliente', 'cosa', 'note', 'assegnato'].map(k => [k, String(f.get(k) || '').trim()])));
    if (!x.id) delete y.id;
    const file = f.get('shot');
    const go2 = () => { dlg.close(); toast('Salvo l\'intervento…'); saveInt(y, x.id ? 'Intervento aggiornato' : 'Intervento creato'); };
    if (file && file.size) compressImage(file).then(d => { y.screenshot = d; go2(); }, err => toast(err.message)); else go2();
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
  if (!Array.isArray(d.capi)) return head() + errBox('Per usare DPI e vestiario va aggiornato lo script Google (guida nel repository).');
  return head(`<button class="btn" data-act="dpiNew">${icon('plus')}Nuova consegna</button><button class="btn ghost" data-act="capi">Capi e durata</button><button class="btn plain" data-act="printScheda">Scheda da firmare</button>`) + `<div class="grid" style="gap:16px">
    <div class="table-box"><table><thead><tr><th>Operatore</th><th>Capo</th><th>Taglia</th><th>Consegnato</th><th>Scadenza</th><th>Stato</th></tr></thead><tbody>
    ${righe.map(r => `<tr data-dedit="${esc(r.id)}"><td class="name"><button class="link" data-dedit="${esc(r.id)}" style="color:var(--ink);text-decoration:none">${esc(r.operatore)}</button></td><td>${esc(r.capo)}</td><td>${esc(r.taglia || '—')}</td><td>${fmtIso(r.data)}</td><td>${fmtIso(r.scadenza)}</td><td>${stChip(r)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessuna consegna registrata.</td></tr>'}
    </tbody></table></div>
    <article class="card"><h2>Da ordinare</h2><p class="sub">Capi scaduti o in scadenza nei prossimi ${FINESTRA_SCAD} giorni</p>
      ${Object.keys(ordine).length ? `<ul style="margin:0;padding-left:18px;display:grid;gap:6px">${Object.entries(ordine).map(([k, n]) => `<li>${n} × ${esc(k)}</li>`).join('')}</ul><button class="btn ghost" data-act="printOrder">Stampa per il fornitore</button>` : '<p class="empty">Niente da ordinare. ✓</p>'}
      <p class="sub">Tocca una riga della tabella per modificare o eliminare la consegna.</p></article></div>`;
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
  const voci = sc.voci.filter(v => v.attiva).map(v => v.nome);
  const ops = (sc.operatori || []).filter(o => o.attivo !== false).map(o => o.nome).filter(n => match(n));
  const vic = scVicine(sc).filter(r => match(r.operatore, r.voce));
  const cell = (op, voce) => {
    const r = ult.find(x => sameName(x.operatore, op) && sameName(x.voce, voce));
    if (!r) return `<button data-screg="${esc(op)}|${esc(voce)}" aria-label="Registra ${esc(voce)} per ${esc(op)}" style="color:#9a9a96">+ registra</button>`;
    const g = daysTo(r.scadenza);
    const cls = g === null ? '' : g < 0 ? 'no' : g <= FINESTRA_SCAD ? 'wait' : '';
    return `<button data-scedit="${esc(r.id)}" aria-label="Modifica ${esc(voce)} di ${esc(op)}">${cls ? chip(cls, fmtIso(r.scadenza)) : r.scadenza ? fmtIso(r.scadenza) : 'fatto ' + fmtIso(r.fatto)}</button>`;
  };
  return head(`<button class="btn" data-act="scNew">${icon('plus')}Registra visita o corso</button><button class="btn ghost" data-act="scVoci">Visite, corsi e durata</button><button class="btn plain" data-act="ops">${icon('dipendenti')}Operatori</button>`) +
    `<article class="card"><div class="card-head"><h2>In scadenza</h2><small>scaduti e nei prossimi ${FINESTRA_SCAD} giorni</small></div>
    <div class="rows">${vic.map(r => `<div class="row"><div class="ini c${daysTo(r.scadenza) < 0 ? 3 : 0}" aria-hidden="true">${esc(initials(r.operatore))}</div><div class="txt"><b>${esc(r.operatore)}</b><span>${esc(r.voce)} · ${fmtIso(r.scadenza)}</span></div>${chip(daysTo(r.scadenza) < 0 ? 'no' : 'wait', scTxt(r))}<button class="btn plain sm" data-screg="${esc(r.operatore)}|${esc(r.voce)}">Rinnova</button></div>`).join('') || '<p class="empty">Niente in scadenza. ✓</p>'}</div></article>
    <div class="table-box"><table><thead><tr><th>Dipendente</th>${voci.map(v => `<th>${esc(v.length > 22 ? v.slice(0, 20) + '…' : v)}</th>`).join('')}</tr></thead><tbody>
    ${ops.map(o => `<tr><td class="name">${esc(o)}</td>${voci.map(v => `<td class="cellbtn">${cell(o, v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${voci.length + 1}" class="empty">Nessun dipendente.</td></tr>`}
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
    <article class="card"><h2>Cantieri</h2><p class="sub">${S.cantieri.filter(c => c.attivo !== false).length} attivi su ${S.cantieri.length}: ${esc(S.cantieri.filter(c => c.attivo !== false).map(c => cap(c.nome)).join(', '))}</p>
      <button class="btn ghost" data-act="sites">Aggiungi, rinomina, colori</button></article>
    <article class="card"><h2>Sede per le timbrature</h2>${sedeTxt()}<button class="btn ghost" data-act="sede">Cambia sede o raggio</button></article>
    <article class="card"><h2>Operatori</h2><p class="sub">Chi compare nel programma, ore settimanali da contratto e cantiere fisso.</p><button class="btn ghost" data-act="ops">${icon('dipendenti')}Gestisci operatori</button></article>
    <article class="card"><h2>App degli operatori</h2><p class="sub">Le timbrature si fanno dall'app Timbra Cantieri sul telefono di ogni operatore. Azzerare tutto il registro si fa ancora da lì.</p>
      <a class="btn plain" href="${APP_URL}" target="_blank" rel="noopener">Apri Timbra Cantieri</a></article></div>`;
}
function sedeTxt() {
  const s = needSede();
  if (s === undefined) return '<p class="sub">Carico la sede…</p>';
  if (s.error) return `<p class="sub">⚠️ ${esc(s.error)}</p>`;
  return isFinite(s.lat) ? `<p class="sub">Si timbra entro <b style="color:var(--ink)">${s.raggio} m</b> dalla sede. <a href="https://maps.google.com/?q=${s.lat},${s.lng}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">Vedi sulla mappa</a></p>` : '<p class="sub">Sede non ancora impostata.</p>';
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

// ---------- Modifiche: timbrature ----------
const toLocalInput = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const sel = (name, opts, cur, extra) => `<select name="${name}" ${extra || ''}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
function tEdit(id) {
  const m = S.month || monthNow(), list = S.cache[tKey(m)];
  const t = Array.isArray(list) && list.find(x => x.id === id); if (!t) return;
  const names = S.cantieri.map(c => c.nome); if (!names.includes(t.cantiere)) names.unshift(t.cantiere);
  openDlg(`<form id="tForm" style="display:grid;gap:12px"><h2>${esc(t.dip)}</h2><p class="sub">${fmtDay(t.start)}${t.sede ? ' · ' + esc(cap(t.sede)) : ''}</p>
    <label class="field">Cantiere${sel('cantiere', names.map(n => [n, cap(n)]), t.cantiere)}</label>
    <label class="field">Entrata<input type="datetime-local" name="start" required value="${toLocalInput(t.start)}"></label>
    <label class="field">Uscita<input type="datetime-local" name="end" value="${t.end ? toLocalInput(t.end) : ''}"></label>
    <div class="actions" style="justify-content:flex-start">${isMap(t.posIn) ? `<a class="btn plain sm" href="${esc(t.posIn.split(' ')[0])}" target="_blank" rel="noopener">Entrata sulla mappa</a>` : ''}${isMap(t.posOut) ? `<a class="btn plain sm" href="${esc(t.posOut.split(' ')[0])}" target="_blank" rel="noopener">Uscita sulla mappa</a>` : ''}</div>
    <div class="actions"><button type="button" class="btn plain" id="tDel" style="color:#a61b1b">Elimina</button><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  const done = msg => { invalidate(tKey(m), tKey(monthNow()), 'extra'); toast(msg); renderPage(); };
  $('#tForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), start = new Date(f.get('start')).getTime(), ev = f.get('end'), end = ev ? new Date(ev).getTime() : null;
    if (!start) return toast('Indica l\'entrata');
    if (end !== null && !(end > start)) return toast('L\'uscita deve essere dopo l\'entrata');
    dlg.close(); toast('Salvo…');
    try { await queued('modifica', { t: { id, start, end, cantiere: String(f.get('cantiere')) } }); done('Timbratura modificata'); } catch (err) { const w = why(err); if (w) toast(w); }
  });
  $('#tDel').addEventListener('click', async () => {
    if (!confirm(`Eliminare la timbratura di ${t.dip} del ${fmtDay(t.start)}?`)) return;
    dlg.close();
    try { await queued('elimina', { id }); done('Timbratura eliminata'); } catch (err) { const w = why(err); if (w) toast(w); }
  });
}

// ---------- Modifiche: cantieri e sede ----------
const SITE_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#0d9488', '#0891b2', '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#78716c', '#1f2937'];
function sitesEdit() {
  const row = (c, i) => `<div class="check" data-siterow><input type="color" name="c${i}" value="${esc(c.colore || SITE_COLORS[i % SITE_COLORS.length])}" aria-label="Colore" style="width:42px;height:36px;border:0;background:none;padding:0">
    <input name="n${i}" value="${esc(c.nome)}" maxlength="60" placeholder="Nome cantiere" aria-label="Nome cantiere" style="flex:1;min-width:0;height:40px;border-radius:10px;border:1px solid #c9ccc2;padding:0 10px;font-size:16px">
    <label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" name="a${i}" ${c.attivo !== false ? 'checked' : ''}>Attivo</label></div>`;
  openDlg(`<form id="siteForm" style="display:grid;gap:12px"><h2>Cantieri</h2>
    <p class="sub">Togli la spunta per nascondere un cantiere (le timbrature restano). Per eliminarlo svuota il nome. Arrivano su tutti i telefoni alla prossima apertura dell'app.</p>
    <div class="checks" id="siteList">${S.cantieri.map(row).join('')}</div>
    <button type="button" class="btn plain" id="siteAdd">+ Aggiungi cantiere</button>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#siteAdd').addEventListener('click', () => { const i = $('#siteList').children.length; $('#siteList').insertAdjacentHTML('beforeend', row({ nome: '', attivo: true }, i)); $('#siteList').lastElementChild.querySelector('input[name^="n"]').focus(); });
  $('#siteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), n = $('#siteList').children.length, cantieri = [];
    for (let i = 0; i < n; i++) { const nome = String(f.get('n' + i) || '').trim(); if (nome) cantieri.push({ nome, attivo: f.get('a' + i) === 'on', colore: String(f.get('c' + i) || '') }); }
    dlg.close(); toast('Salvo i cantieri…');
    try {
      const out = await queued('salva', { cantieri });
      S.cantieri = out.cantieri || cantieri;
      if (S.plan && !S.plan.dirty) S.plan = null;
      Object.keys(S.cache).filter(k => k.startsWith('p:')).forEach(k => delete S.cache[k]);
      toast('Cantieri salvati');
    } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
function needSede() {
  if ('sede' in S.cache || S.loading.sede) return S.cache.sede;
  S.loading.sede = true;
  const p = S.demo ? Promise.resolve({ lat: 43.7080, lng: 10.4210, raggio: 200 }) : queued('codice').then(o => withTimeout(fetch(`${ENDPOINT}?azione=cantieri&codice=${encodeURIComponent(o.codice || '')}`), 30000)).then(r => r.json()).then(j => (j.config && j.config.sede) || {});
  p.then(s => { S.cache.sede = s || {}; }, e => { S.cache.sede = { error: why(e) }; }).finally(() => { delete S.loading.sede; renderPage(); });
  return undefined;
}
function sedeEdit() {
  const s = S.cache.sede || {};
  openDlg(`<form id="sedeForm" style="display:grid;gap:12px"><h2>Sede per le timbrature</h2>
    <p class="sub">Entrata e uscita si timbrano solo entro il raggio da questo punto (gli impianti Ecofor Service ed Ecoacciai hanno la loro zona).</p>
    ${isFinite(s.lat) ? `<a class="btn plain" href="https://maps.google.com/?q=${s.lat},${s.lng}" target="_blank" rel="noopener">Vedi la sede sulla mappa</a>` : '<p class="empty">Sede non ancora impostata.</p>'}
    <label class="field">Raggio${sel('raggio', [100, 150, 200, 300, 500].map(r => [r, r + ' metri']), s.raggio || 200)}</label>
    <p class="sub">Per centrare la sede con precisione premi il pulsante mentre sei in ufficio.</p>
    <button type="button" class="btn" id="sedeHere">Usa la mia posizione attuale</button>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button>${isFinite(s.lat) ? '<button class="btn ghost" type="submit">Salva solo il raggio</button>' : ''}</div></form>`);
  const save = async (lat, lng) => {
    const raggio = Number(new FormData($('#sedeForm')).get('raggio'));
    dlg.close(); toast('Salvo la sede…');
    try { const out = await queued('sede', { sede: { lat, lng, raggio } }); S.cache.sede = out.sede || { lat, lng, raggio }; toast('Sede salvata'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  };
  $('#sedeForm').addEventListener('submit', e => { e.preventDefault(); save(s.lat, s.lng); });
  $('#sedeHere').addEventListener('click', e => {
    if (!navigator.geolocation) return toast('Posizione non disponibile su questo dispositivo');
    e.target.disabled = true; e.target.textContent = 'Rilevo la posizione…';
    navigator.geolocation.getCurrentPosition(p => {
      if (p.coords.accuracy > 100) { e.target.disabled = false; e.target.textContent = 'Usa la mia posizione attuale'; return toast(`Segnale GPS poco preciso (±${Math.round(p.coords.accuracy)} m): riprova vicino a una finestra`); }
      save(p.coords.latitude, p.coords.longitude);
    }, err => { e.target.disabled = false; e.target.textContent = 'Usa la mia posizione attuale'; toast('Posizione non disponibile: ' + err.message); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

// ---------- Modifiche: DPI ----------
const TAGLIA_LBL = { maglia: 'Maglia', pantalone: 'Pantalone', scarpe: 'Scarpe' };
const mesiTxt = m => !m ? 'senza scadenza' : m % 12 === 0 ? `ogni ${m / 12 === 1 ? 'anno' : m / 12 + ' anni'}` : `ogni ${m} mesi`;
const dpiPeople = d => (d.operatori || []).filter(o => o.attivo !== false).map(o => o.nome);
const taglieDi = (d, n) => (d.taglie || {})[String(n).trim().toLowerCase()] || { maglia: '', pantalone: '', scarpe: '', note: '' };
function dpiNew(nome) {
  const d = S.cache.dpi; if (!d || d.error) return;
  const people = dpiPeople(d), capi = (d.capi || []).filter(c => c.attivo), cur = nome || people[0] || '';
  if (!capi.length) return toast('Prima aggiungi i capi da "Capi e durata"');
  const t = taglieDi(d, cur);
  openDlg(`<form id="dpiForm" style="display:grid;gap:12px"><h2>Nuova consegna</h2>
    <div class="grid g-2" style="gap:12px"><label class="field">Operatore${sel('op', people, cur, 'id="dpiOp"')}</label><label class="field">Data<input type="date" name="data" value="${todayIso()}"></label></div>
    <p class="sub">Spunta i capi consegnati. La taglia salvata per l'operatore si aggiorna se la cambi.</p>
    <div class="checks">${capi.map((c, i) => `<label class="check"><input type="checkbox" name="c${i}"><span>${esc(c.nome)}<em>${mesiTxt(c.mesi)}</em></span>
      ${c.taglia ? `<input class="mini" name="t${i}" data-tipo="${c.taglia}" value="${esc(t[c.taglia] || '')}" placeholder="${TAGLIA_LBL[c.taglia]}" aria-label="Taglia ${esc(c.nome)}">` : ''}
      <input class="mini" name="q${i}" inputmode="numeric" value="1" aria-label="Quantità ${esc(c.nome)}"></label>`).join('')}</div>
    <label class="field">Note (facoltative)<input name="note" maxlength="200" placeholder="es. sostituzione per usura"></label>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Registra</button></div></form>`);
  $('#dpiOp').addEventListener('change', e => { const tt = taglieDi(d, e.target.value); document.querySelectorAll('#dpiForm [data-tipo]').forEach(i => { i.value = tt[i.dataset.tipo] || ''; }); });
  $('#dpiForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), op = String(f.get('op') || ''), righe = [], taglie = Object.assign({}, taglieDi(d, op));
    capi.forEach((c, i) => { const tg = String(f.get('t' + i) || '').trim(); if (c.taglia && tg) taglie[c.taglia] = tg; if (f.get('c' + i)) righe.push({ capo: c.nome, taglia: tg, qta: Number(f.get('q' + i)) || 1 }); });
    if (!op || !righe.length) return toast('Scegli l\'operatore e almeno un capo');
    dlg.close(); toast('Registro la consegna…');
    try { S.cache.dpi = await queued('dpiconsegna', { consegna: { id: uid(), data: String(f.get('data') || todayIso()), operatore: op, righe, note: String(f.get('note') || '').trim(), taglie } }); toast(`Consegna registrata (${righe.length} ${righe.length === 1 ? 'capo' : 'capi'})`); }
    catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
function dpiEdit(id) {
  const d = S.cache.dpi; const c = d && d.consegne && d.consegne.find(x => x.id === id); if (!c) return;
  const capi = (d.capi || []).filter(x => x.attivo || x.nome === c.capo).map(x => x.nome); if (!capi.includes(c.capo)) capi.unshift(c.capo);
  openDlg(`<form id="dpiEd" style="display:grid;gap:12px"><h2>Modifica consegna</h2><p class="sub">${esc(c.operatore)}</p>
    <label class="field">Capo${sel('capo', capi, c.capo)}</label>
    <label class="field">Data di consegna<input type="date" name="data" required value="${esc(c.data)}"></label>
    <div class="grid g-2" style="gap:12px"><label class="field">Taglia<input name="taglia" maxlength="10" value="${esc(c.taglia || '')}"></label><label class="field">Quantità<input name="qta" inputmode="numeric" value="${c.qta || 1}"></label></div>
    <label class="field">Note<input name="note" maxlength="200" value="${esc(c.note || '')}"></label>
    <p class="sub">La scadenza si ricalcola dalla data e dalla durata del capo.</p>
    <div class="actions"><button type="button" class="btn plain" id="dpiDel" style="color:#a61b1b">Elimina</button><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#dpiDel').addEventListener('click', async () => {
    if (!confirm(`Eliminare la consegna di ${c.capo} del ${fmtIso(c.data)}?`)) return;
    dlg.close();
    try { S.cache.dpi = await queued('dpielimina', { id: c.id }); toast('Consegna eliminata'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
  $('#dpiEd').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const nuova = { id: uid(), data: String(f.get('data') || c.data), operatore: c.operatore, note: String(f.get('note') || '').trim(), righe: [{ capo: String(f.get('capo') || c.capo), taglia: String(f.get('taglia') || '').trim(), qta: Number(f.get('qta')) || 1 }] };
    dlg.close(); toast('Salvo la modifica…');
    try { await queued('dpielimina', { id: c.id }); S.cache.dpi = await queued('dpiconsegna', { consegna: nuova }); toast('Consegna modificata'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
function capiEdit() {
  const d = S.cache.dpi; if (!d || d.error) return;
  const capi = d.capi || [];
  openDlg(`<form id="capiForm" style="display:grid;gap:12px"><h2>Capi e durata</h2>
    <p class="sub">Ogni quanti mesi si sostituisce un capo (0 = nessuna scadenza). Togli la spunta per non usarlo più.</p>
    <div class="checks">${capi.map((c, i) => `<label class="check"><input type="checkbox" name="a${i}" ${c.attivo ? 'checked' : ''}><span>${esc(c.nome)}${c.taglia ? `<em>taglia: ${TAGLIA_LBL[c.taglia]}</em>` : ''}</span><input class="mini" name="m${i}" inputmode="numeric" value="${c.mesi}" aria-label="Mesi ${esc(c.nome)}"> mesi</label>`).join('')}</div>
    <div class="grid g-2" style="gap:12px"><label class="field">Aggiungi un capo<input name="nuovo" maxlength="60" placeholder="es. Tappi antirumore"></label>
    <label class="field">Con taglia${sel('taglia', [['', 'Nessuna'], ['maglia', 'Maglia'], ['pantalone', 'Pantalone'], ['scarpe', 'Scarpe']], '')}</label></div>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#capiForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const lista = capi.map((c, i) => ({ nome: c.nome, taglia: c.taglia, mesi: Number(f.get('m' + i)) || 0, attivo: !!f.get('a' + i) }));
    const nuovo = String(f.get('nuovo') || '').trim();
    if (nuovo && !lista.some(c => sameName(c.nome, nuovo))) lista.push({ nome: nuovo.charAt(0).toUpperCase() + nuovo.slice(1), taglia: String(f.get('taglia') || ''), mesi: 12, attivo: true });
    dlg.close(); toast('Salvo i capi…');
    try { S.cache.dpi = await queued('dpicapi', { capi: lista }); toast('Capi salvati'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
function dpiScadute(d) {
  const ops = new Set(dpiPeople(d).map(n => n.toLowerCase())), last = {};
  (d.consegne || []).forEach(c => { const k = c.operatore.toLowerCase() + '|' + c.capo.toLowerCase(); if (!last[k] || last[k].data < c.data) last[k] = c; });
  return Object.values(last).filter(c => (!ops.size || ops.has(c.operatore.toLowerCase())) && c.scadenza && daysTo(c.scadenza) <= FINESTRA_SCAD);
}
function printOrder() {
  const d = S.cache.dpi; if (!d || d.error) return;
  const m = {};
  dpiScadute(d).forEach(c => { const tg = c.taglia || '—', k = c.capo + '|' + tg; (m[k] = m[k] || { capo: c.capo, taglia: tg, qta: 0, chi: [] }); m[k].qta += c.qta || 1; m[k].chi.push(c.operatore); });
  const rows = Object.values(m).sort((a, b) => a.capo.localeCompare(b.capo));
  printDoc(`<div class="pdoc"><div class="pdoc-h"><img src="../logo.png" alt="GE3CO"><div><h1>DPI e vestiario da ordinare</h1><p>Aggiornato al ${fmtIso(todayIso())}</p></div></div>
    <table><thead><tr><th>Capo</th><th>Taglia</th><th>Quantità</th><th>Per</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.capo)}</td><td>${esc(r.taglia)}</td><td><b>${r.qta}</b></td><td>${r.chi.map(esc).join(', ')}</td></tr>`).join('') || '<tr><td colspan="4">Niente da ordinare.</td></tr>'}</tbody></table></div>`);
}
function printScheda() {
  const d = S.cache.dpi; if (!d || d.error) return;
  openDlg(`<form id="schForm" style="display:grid;gap:12px"><h2>Scheda consegna da firmare</h2><label class="field">Operatore${sel('op', dpiPeople(d), '')}</label>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Stampa o salva PDF</button></div></form>`);
  $('#schForm').addEventListener('submit', e => {
    e.preventDefault();
    const nome = String(new FormData(e.target).get('op')), t = taglieDi(d, nome);
    const cons = (d.consegne || []).filter(c => sameName(c.operatore, nome)).sort((a, b) => a.data.localeCompare(b.data));
    dlg.close();
    printDoc(`<div class="pdoc"><div class="pdoc-h"><img src="../logo.png" alt="GE3CO"><div><h1>Scheda consegna DPI e vestiario</h1>
      <p>Operatore: <b>${esc(nome)}</b> · Taglie: maglia ${esc(t.maglia || '—')}, pantalone ${esc(t.pantalone || '—')}, scarpe ${esc(t.scarpe || '—')}</p></div></div>
      <table><thead><tr><th>Data</th><th>Capo / DPI</th><th>Taglia</th><th>Q.tà</th><th>Scadenza</th><th style="width:22%">Firma operatore</th></tr></thead>
      <tbody>${cons.map(c => `<tr><td>${fmtIso(c.data)}</td><td>${esc(c.capo)}</td><td>${esc(c.taglia || '')}</td><td>${c.qta}</td><td>${c.scadenza ? fmtIso(c.scadenza) : ''}</td><td style="height:26px"></td></tr>`).join('') || '<tr><td colspan="6">Nessuna consegna registrata.</td></tr>'}</tbody></table>
      <p>Il lavoratore dichiara di aver ricevuto i dispositivi sopra indicati e si impegna a utilizzarli correttamente e a conservarli con cura (D.Lgs. 81/2008, art. 20 e 78).</p>
      <p style="margin-top:22px">Data ________________ &nbsp; Firma del lavoratore ______________________ &nbsp; Firma del responsabile ______________________</p></div>`);
  });
}

// ---------- Modifiche: visite e corsi ----------
function scReg(pre) {
  const sc = S.cache.scad; if (!sc || !Array.isArray(sc.voci)) return;
  const people = (sc.operatori || []).filter(o => o.attivo !== false).map(o => o.nome);
  const voci = sc.voci.filter(v => v.attiva || (pre && v.nome === pre.voce));
  const p = Object.assign({ operatore: people[0] || '', voce: (voci[0] || {}).nome || '', fatto: todayIso(), scadenza: '', note: '' }, pre || {});
  const cats = [...new Set(voci.map(v => v.cat))];
  openDlg(`<form id="scForm" style="display:grid;gap:12px"><h2>${p.id ? 'Modifica' : 'Registra visita o corso'}</h2>
    <label class="field">Operatore${sel('op', people.concat(p.operatore && !people.includes(p.operatore) ? [p.operatore] : []), p.operatore)}</label>
    <label class="field">Visita o corso<select name="voce" id="scVoce">${cats.map(c => `<optgroup label="${esc(c)}">${voci.filter(v => v.cat === c).map(v => `<option value="${esc(v.nome)}" data-mesi="${v.mesi}" ${v.nome === p.voce ? 'selected' : ''}>${esc(v.nome)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <div class="grid g-2" style="gap:12px"><label class="field">Fatto il<input type="date" name="fatto" id="scFatto" required value="${esc(p.fatto)}"></label>
    <label class="field">Scade il<input type="date" name="scad" id="scScad" value="${esc(p.scadenza)}"></label></div>
    <p class="sub" id="scHint"></p>
    <label class="field">Note (niente dati sanitari)<input name="note" maxlength="200" value="${esc(p.note)}" placeholder="es. ente del corso, attestato in ufficio"></label>
    <div class="actions">${p.id ? '<button type="button" class="btn plain" id="scDel" style="color:#a61b1b">Elimina</button>' : ''}<button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  const calc = () => {
    const o = $('#scVoce').selectedOptions[0], m = Number(o && o.dataset.mesi) || 0, f = $('#scFatto').value;
    if (!f) return;
    if (!m) { $('#scHint').textContent = 'Questa voce non ha scadenza: lascia vuoto o scrivi una data.'; return; }
    const d = dayOf(f); d.setMonth(d.getMonth() + m); $('#scScad').value = isoOf(d);
    $('#scHint').textContent = `Calcolata: ${fmtIso(isoOf(d))} (ogni ${m} mesi). Si può cambiare.`;
  };
  $('#scVoce').addEventListener('change', calc); $('#scFatto').addEventListener('change', calc);
  if (!p.scadenza) calc();
  const del = $('#scDel');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Eliminare questa registrazione?')) return;
    dlg.close();
    try { S.cache.scad = await queued('scadelimina', { id: p.id }); toast('Eliminata'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
  $('#scForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const reg = { id: p.id || uid(), operatore: String(f.get('op') || ''), voce: String(f.get('voce') || ''), fatto: String(f.get('fatto') || ''), scadenza: String(f.get('scad') || ''), note: String(f.get('note') || '').trim() };
    if (!reg.operatore || !reg.voce || !reg.fatto) return toast('Servono operatore, voce e data');
    dlg.close(); toast('Salvo…');
    try { S.cache.scad = await queued('scadreg', { reg }); toast('Registrato'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
function scVociEdit() {
  const sc = S.cache.scad; if (!sc || !Array.isArray(sc.voci)) return;
  openDlg(`<form id="vociForm" style="display:grid;gap:12px"><h2>Visite, corsi e durata</h2>
    <p class="sub">Ogni quanti mesi si rinnova ogni voce (0 = nessuna scadenza). Confermate le durate con RSPP e medico competente.</p>
    <div class="checks">${sc.voci.map((v, i) => `<label class="check"><input type="checkbox" name="a${i}" ${v.attiva ? 'checked' : ''}><span>${esc(v.nome)}<em>${esc(v.cat)}</em></span><input class="mini" name="m${i}" inputmode="numeric" value="${v.mesi}" aria-label="Mesi ${esc(v.nome)}"> mesi</label>`).join('')}</div>
    <div class="grid g-2" style="gap:12px"><label class="field">Aggiungi una voce<input name="nuovo" maxlength="80" placeholder="es. Spazi confinati"></label>
    <label class="field">Tipo${sel('cat', ['Formazione', 'Sorveglianza sanitaria', 'Abilitazioni', 'Patenti e CQC'], 'Formazione')}</label></div>
    <div class="actions"><button type="button" class="btn plain" data-act="close">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`);
  $('#vociForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const lista = sc.voci.map((v, i) => ({ nome: v.nome, cat: v.cat, mesi: Number(f.get('m' + i)) || 0, attiva: !!f.get('a' + i) }));
    const nuovo = String(f.get('nuovo') || '').trim();
    if (nuovo && !lista.some(v => sameName(v.nome, nuovo))) lista.push({ nome: nuovo.charAt(0).toUpperCase() + nuovo.slice(1), cat: String(f.get('cat') || 'Formazione'), mesi: 12, attiva: true });
    dlg.close(); toast('Salvo…');
    try { S.cache.scad = await queued('scadvoci', { voci: lista }); toast('Salvato'); } catch (err) { const w = why(err); if (w) toast(w); }
    renderPage();
  });
}
// Foto ridotte (lato lungo max 1280 px, JPEG), come nell'app
function compressImage(file, max = 1280, q = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', q)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto non leggibile')); };
    img.src = url;
  });
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
  if (document.body.classList.contains('printing')) endPrint();
  const el = e.target.closest('[data-tedit],[data-dedit],[data-screg],[data-scedit],[data-sq],[data-addsq],[data-assday],[data-go],[data-act],[data-tf],[data-if],[data-week],[data-foto],[data-assign],[data-reopen],[data-editint],[data-delint],[data-extra],[data-ass],[data-pdf],[data-copy]');
  if (!el) return;
  const d = el.dataset;
  if (d.go) return go(d.go);
  if (d.tf) { S.tFilter = d.tf; return renderPage(); }
  if (d.if) { S.iFilter = d.if; return renderPage(); }
  if (d.week) return changeWeek(d.week === '0' ? mondayOf(todayIso()) : addDays(S.week || mondayOf(todayIso()), Number(d.week)));
  if (d.tedit) return tEdit(d.tedit);
  if (d.dedit) return dpiEdit(d.dedit);
  if (d.screg) { const [op, voce] = d.screg.split('|'); return scReg({ operatore: op, voce }); }
  if (d.scedit) { const r = S.cache.scad && S.cache.scad.righe.find(x => x.id === d.scedit); return r && scReg(Object.assign({}, r)); }
  if (d.sq) return sqEdit(d.sq);
  if (d.addsq) { const [dd, tt] = d.addsq.split('|'); return sqEdit(null, dd, tt); }
  if (d.assday) return assEdit(d.assday);
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
    case 'sites': return sitesEdit();
    case 'sede': return sedeEdit();
    case 'dpiNew': return dpiNew();
    case 'capi': return capiEdit();
    case 'printOrder': return printOrder();
    case 'printScheda': return printScheda();
    case 'scNew': return scReg();
    case 'scVoci': return scVociEdit();
    case 'savePlan': return savePlan(el);
    case 'undoPlan': if (confirm('Annullare le modifiche non salvate?')) { S.plan = null; renderPage(); } return;
    case 'copyPrev': return copyPrev();
    case 'ops': return opsEdit();
    case 'printPlan': return printPlan();
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
window.addEventListener('beforeunload', e => { if (S.plan && S.plan.dirty) { e.preventDefault(); e.returnValue = ''; } });
// Tornando sull'app dopo un po', i dati si ricaricano
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if ((S.pwd || S.demo) && hiddenAt && Date.now() - hiddenAt > 5 * 60000) { S.cache = {}; renderPage(); }
});

// ---------- Modalità prova (dati finti, niente rete) ----------
let DEMO_DB = null;
const DEMO_SITES = () => (DEMO_DB && DEMO_DB.cantieri) || ['PONTEDERA', 'BIENTINA', 'CASCINA', 'CALCINAIA', 'ECOFOR SERVICE', 'ECOACCIAI'].map((n, i) => ({ nome: n, attivo: true, colore: SITE_COLORS[(i * 3) % SITE_COLORS.length] }));
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
  }
  squadre.push({ id: 'dsf', data: addDays(mon, 3), turno: 'Ferie', cantiere: '', operatori: [ops[7]] });
  const operatori = ops.map((o, i) => ({ nome: o, attivo: true, ore: i === 2 || i === 4 ? 40 : 30, fisso: i === 4 ? 'ECOFOR SERVICE' : i === 2 ? 'ECOACCIAI' : '' }));
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
    dpi: { capi: [{ nome: 'Scarpe S3', taglia: 'scarpe', mesi: 12, attivo: true }, { nome: 'Guanti anti-taglio', taglia: '', mesi: 6, attivo: true }, { nome: 'Giubbotto alta visibilità', taglia: 'maglia', mesi: 24, attivo: true }, { nome: 'Pantaloni alta visibilità', taglia: 'pantalone', mesi: 12, attivo: true }],
      taglie: { 'mario rossi': { maglia: 'L', pantalone: '50', scarpe: '43', note: '' } }, operatori, consegne: ops.flatMap((o, i) => [
      { id: 'dc' + i, data: addDays(today, -200 - i * 20), operatore: o, capo: 'Scarpe S3', taglia: String(41 + (i % 4)), qta: 1, scadenza: addDays(today, 165 - i * 25), note: '' },
      { id: 'dg' + i, data: addDays(today, -150), operatore: o, capo: 'Guanti anti-taglio', taglia: 'L', qta: 2, scadenza: addDays(today, 30 - i * 6), note: '' }]) }
  };
}
async function demoApi(azione, x) {
  if (!DEMO_DB) DEMO_DB = demoBuild();
  const D = DEMO_DB;
  await new Promise(r => setTimeout(r, 120));
  const ok = o => Object.assign({ ok: true }, o);
  const cantieri = DEMO_SITES();
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
    case 'modifica': D.t.forEach(t => { if (t.id === x.t.id) Object.assign(t, { start: x.t.start, end: x.t.end, cantiere: x.t.cantiere }); }); return ok({});
    case 'elimina': D.t = D.t.filter(t => t.id !== x.id); return ok({});
    case 'salvaprogramma': D.squadre = D.squadre.filter(s => s.data < x.da || s.data > x.a).concat(clone(x.squadre)); return ok({ squadre: D.squadre.filter(s => s.data >= x.da && s.data <= x.a), operatori: D.operatori, cantieri: DEMO_SITES() });
    case 'operatori': D.operatori = clone(x.operatori); D.scad.operatori = D.operatori; D.dpi.operatori = D.operatori; return ok({ operatori: D.operatori });
    case 'salva': D.cantieri = x.cantieri.map(c => Object.assign({}, c, { nome: c.nome.toUpperCase() })); return ok({ cantieri: D.cantieri });
    case 'sede': return ok({ sede: x.sede });
    case 'dpiconsegna': x.consegna.righe.forEach((r, i) => { const c = D.dpi.capi.find(k => k.nome === r.capo) || { mesi: 0 }; const dd = dayOf(x.consegna.data); dd.setMonth(dd.getMonth() + c.mesi);
      D.dpi.consegne.unshift({ id: x.consegna.id + '-' + i, data: x.consegna.data, operatore: x.consegna.operatore, capo: r.capo, taglia: r.taglia, qta: r.qta, scadenza: c.mesi ? isoOf(dd) : '', note: x.consegna.note }); });
      if (x.consegna.taglie) D.dpi.taglie[x.consegna.operatore.toLowerCase()] = x.consegna.taglie; return ok(D.dpi);
    case 'dpielimina': D.dpi.consegne = D.dpi.consegne.filter(c => c.id !== x.id); return ok(D.dpi);
    case 'dpicapi': D.dpi.capi = clone(x.capi); return ok(D.dpi);
    case 'scadreg': D.scad.righe = D.scad.righe.filter(r => r.id !== x.reg.id).concat([Object.assign({}, x.reg)]); return ok(D.scad);
    case 'scadelimina': D.scad.righe = D.scad.righe.filter(r => r.id !== x.id); return ok(D.scad);
    case 'scadvoci': D.scad.voci = clone(x.voci); return ok(D.scad);
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
