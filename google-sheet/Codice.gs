/**
 * Timbra Cantieri – raccolta timbrature su Google Sheet + riepilogo mensile.
 *
 * Installazione: vedi GUIDA-GOOGLE-SHEET.md nel repository.
 * Da impostare: ID_FOGLIO (ed eventualmente EMAIL_RESPONSABILE) qui sotto.
 */

// ID del Google Sheet: la parte dell'indirizzo tra /d/ e /edit.
const ID_FOGLIO = 'INSERISCI_ID_FOGLIO';

// Chi riceve il riepilogo a inizio mese (più indirizzi separati da virgola).
// Vuoto = l'email dell'account Google proprietario dello script.
const EMAIL_RESPONSABILE = '';

// Turno standard: ogni servizio (ingombranti) vale ORE_TURNO ore fisse.
// Oltre ORE_TURNO + TOLLERANZA_MIN il dipendente deve giustificare: l'extra conta solo se autorizzato.
const ORE_TURNO = 5;
const TOLLERANZA_MIN = 15;
// Chi autorizza le ore extra (riceve la richiesta su WhatsApp). Telefono con prefisso, senza + né spazi.
const AUTORIZZA_NOME = 'INSERISCI_NOME';
const AUTORIZZA_TELEFONO = 'INSERISCI_TELEFONO';

const FOGLIO_TIMBRATURE = 'Timbrature';
const INTESTAZIONE = ['ID', 'Dipendente', 'Data', 'Cantiere', 'Entrata', 'Uscita', 'Ore', 'Stato', 'Telefono', 'Aggiornato',
  'Extra (ore)', 'Motivo extra', 'Nota extra', 'Stato extra'];
// Indici (base 1) delle colonne extra
const COL_EXTRA = 11, COL_MOTIVO = 12, COL_NOTA = 13, COL_STATO_EXTRA = 14;
const EXTRA_ATTESA = 'Da autorizzare', EXTRA_OK = 'Autorizzato', EXTRA_NO = 'Non autorizzato';

function ss_() { return SpreadsheetApp.openById(ID_FOGLIO); }

/** Esegui UNA volta dall'editor: crea il menu nel foglio e l'invio automatico il 1° del mese. */
function configura() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ID_FOGLIO).onOpen().create();
  ScriptApp.newTrigger('inviaRiepilogoMeseScorso').timeBased().onMonthDay(1).atHour(7).create();
  foglio_();
  foglioCantieri_();
}

// ---------- Ricezione dall'app ----------

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.admin) return json_(admin_(body.admin));
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const ok = [];
    ops.forEach(op => {
      if (op.type === 'upsert') upsert_(op.shift, body.user);
      else if (op.type === 'delete') remove_(op.id);
      ok.push(op.opId);
    });
    return json_({ ok: true, done: ok });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Apri l'URL della web app nel browser per verificare che funzioni.
function doGet(e) {
  if (e && e.parameter && e.parameter.azione === 'cantieri') {
    return json_({ ok: true, cantieri: cantieri_(), config: {
      oreTurno: ORE_TURNO, tolleranzaMin: TOLLERANZA_MIN,
      autorizzaNome: AUTORIZZA_NOME.indexOf('INSERISCI') === 0 ? '' : AUTORIZZA_NOME,
      autorizzaTelefono: AUTORIZZA_TELEFONO.indexOf('INSERISCI') === 0 ? '' : AUTORIZZA_TELEFONO,
    } });
  }
  return json_({ ok: true, app: 'Timbra Cantieri' });
}

// ---------- Elenco cantieri (scheda "Cantieri", gestita dal responsabile) ----------

const FOGLIO_CANTIERI = 'Cantieri';
const CANTIERI_INIZIALI = ['PISA', 'SAN GIULIANO TERME', 'CASCINA', 'CALCINAIA', 'PONTEDERA',
  'MONTOPOLI', 'SANTA MARIA A MONTE', 'PONSACCO', 'CASCIANA TERME / LARI', 'CAPANNOLI'];

function foglioCantieri_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FOGLIO_CANTIERI);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_CANTIERI);
    sh.getRange(1, 1, 1, 2).setValues([['Cantiere', 'Attivo']]).setFontWeight('bold').setBackground('#e7f2ea');
    sh.getRange(2, 1, CANTIERI_INIZIALI.length, 2).setValues(CANTIERI_INIZIALI.map(n => [n, 'SI']));
    sh.getRange(2, 2, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO']).build());
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 260);
    sh.getRange('D1').setValue('Scrivi un cantiere per riga. "NO" in Attivo lo nasconde dall\'app senza perdere le timbrature.')
      .setFontStyle('italic').setFontColor('#6b766e');
  }
  return sh;
}

// ---------- Gestione cantieri dall'app (protetta da password) ----------
// La password si imposta in Impostazioni progetto → Proprietà script → PASSWORD_ADMIN.

function admin_(req) {
  const props = PropertiesService.getScriptProperties();
  const giusta = props.getProperty('PASSWORD_ADMIN');
  // Prima volta: la password la crea il responsabile dall'app.
  if (!giusta) {
    if (req.azione !== 'imposta') return { ok: false, error: 'nopass', msg: 'Crea la password del responsabile.' };
    const nuova = String(req.nuova || '');
    if (nuova.length < 6) return { ok: false, error: 'corta', msg: 'La password deve avere almeno 6 caratteri.' };
    props.setProperty('PASSWORD_ADMIN', nuova);
    return { ok: true };
  }
  const cache = CacheService.getScriptCache();
  const tentativi = Number(cache.get('tentativi_admin') || 0);
  if (tentativi >= 5) return { ok: false, error: 'bloccato', msg: 'Troppi tentativi sbagliati. Riprova tra 15 minuti.' };
  if (String(req.password || '') !== giusta) {
    cache.put('tentativi_admin', String(tentativi + 1), 900);
    return { ok: false, error: 'password', msg: 'Password sbagliata.' };
  }
  cache.remove('tentativi_admin');

  const anno = Number(req.anno), mese = Number(req.mese);
  switch (req.azione) {
    case 'salva': salvaCantieri_(req.cantieri); return { ok: true, cantieri: tuttiCantieri_() };
    case 'report': {
      const r = creaRiepilogo_(anno, mese);
      return { ok: true, nomeMese: r.nomeMese, intest: r.intest, righe: r.righe, totale: r.totale };
    }
    case 'pdf': {
      const r = creaRiepilogo_(anno, mese);
      SpreadsheetApp.flush();
      const blob = esporta_(r.sheetId, 'pdf');
      return { ok: true, nome: 'GE3CO ' + r.titolo + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
    }
    case 'email': inviaRiepilogo_(anno, mese); return { ok: true };
    case 'timbrature': return { ok: true, timbrature: timbratureMese_(anno, mese), cantieri: tuttiCantieri_() };
    case 'modifica': modificaTimbratura_(req.t); return { ok: true };
    case 'elimina': remove_(req.id); return { ok: true };
    case 'extra': return { ok: true, extra: extraInAttesa_() };
    case 'decidi': decidiExtra_(req.id, !!req.approva); return { ok: true, extra: extraInAttesa_() };
    case 'cambiapassword': {
      const nuova = String(req.nuova || '');
      if (nuova.length < 6) return { ok: false, msg: 'La password deve avere almeno 6 caratteri.' };
      props.setProperty('PASSWORD_ADMIN', nuova);
      return { ok: true };
    }
    default: return { ok: true, cantieri: tuttiCantieri_(), extraInAttesa: extraInAttesa_().length };
  }
}

function esporta_(sheetId, formato) {
  const url = 'https://docs.google.com/spreadsheets/d/' + ID_FOGLIO + '/export?format=' + formato + '&gid=' + sheetId +
    (formato === 'pdf' ? '&portrait=false&fitw=true&gridlines=false&sheetnames=false&printtitle=false' : '');
  return UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob();
}

function timbratureMese_(anno, mese) {
  const sh = foglio_();
  if (sh.getLastRow() < 2) return [];
  const da = new Date(anno, mese, 1), a = new Date(anno, mese + 1, 1);
  return sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues()
    .filter(r => r[4] instanceof Date && r[4] >= da && r[4] < a)
    .map(r => ({ id: String(r[0]), dip: String(r[1]), cantiere: String(r[3]),
      start: r[4].getTime(), end: r[5] instanceof Date ? r[5].getTime() : null,
      extra: Number(r[COL_EXTRA - 1]) || 0, statoExtra: String(r[COL_STATO_EXTRA - 1] || '') }))
    .sort((x, y) => y.start - x.start);
}

function modificaTimbratura_(t) {
  if (!t || !t.id) return;
  const sh = foglio_();
  const r = trovaRiga_(sh, t.id);
  if (!r) return;
  const dip = sh.getRange(r, 2).getValue();
  const tel = sh.getRange(r, 9).getValue();
  upsert_({ id: t.id, start: t.start, end: t.end, site: t.cantiere }, { name: dip, device: tel });
}

function tuttiCantieri_() {
  const sh = foglioCantieri_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(r => String(r[0]).trim())
    .map(r => ({ nome: String(r[0]).trim().toUpperCase(), attivo: String(r[1]).trim().toUpperCase() !== 'NO' }));
}

function salvaCantieri_(lista) {
  if (!Array.isArray(lista)) return;
  const righe = [];
  const visti = {};
  lista.forEach(c => {
    const nome = String(c && c.nome || '').trim().toUpperCase().slice(0, 60);
    if (!nome || visti[nome]) return;
    visti[nome] = true;
    righe.push([nome, c.attivo === false ? 'NO' : 'SI']);
  });
  const sh = foglioCantieri_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  if (righe.length) sh.getRange(2, 1, righe.length, 2).setValues(righe);
}

function cantieri_() {
  const sh = foglioCantieri_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(r => String(r[0]).trim() && String(r[1]).trim().toUpperCase() !== 'NO')
    .map(r => String(r[0]).trim().toUpperCase());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function foglio_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FOGLIO_TIMBRATURE);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_TIMBRATURE, 0);
    sh.appendRow(INTESTAZIONE);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, INTESTAZIONE.length).setFontWeight('bold').setBackground('#e7f2ea');
    sh.hideColumns(1); // l'ID serve solo all'app
    sh.getRange('C:C').setNumberFormat('dd/mm/yyyy');
    sh.getRange('E:F').setNumberFormat('HH:mm');
    sh.getRange('G:G').setNumberFormat('0.00');
    sh.getRange('J:J').setNumberFormat('dd/mm/yyyy HH:mm');
  }
  // Fogli creati con la versione precedente: aggiunge le colonne extra.
  if (sh.getLastColumn() < INTESTAZIONE.length) {
    sh.getRange(1, 1, 1, INTESTAZIONE.length).setValues([INTESTAZIONE]).setFontWeight('bold').setBackground('#e7f2ea');
  }
  return sh;
}

function trovaRiga_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function upsert_(s, user) {
  if (!s || !s.id || !s.start) return;
  const sh = foglio_();
  const start = new Date(s.start);
  const end = s.end ? new Date(s.end) : '';
  const giorno = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const ore = s.end ? Math.round((s.end - s.start) / 36e5 * 100) / 100 : '';
  const nome = user && user.name ? user.name : 'Sconosciuto';
  let r = trovaRiga_(sh, s.id);
  const prima = r ? sh.getRange(r, 1, 1, INTESTAZIONE.length).getValues()[0] : null;

  // Ore extra oltre il turno standard
  const minuti = s.end ? Math.round((s.end - s.start) / 60000) : 0;
  const extraMin = minuti > ORE_TURNO * 60 + TOLLERANZA_MIN ? minuti - ORE_TURNO * 60 : 0;
  const motivo = (s.extra && s.extra.motivo) || (prima && prima[COL_MOTIVO - 1]) || '';
  const nota = (s.extra && s.extra.nota) || (prima && prima[COL_NOTA - 1]) || '';
  let statoExtra = '';
  if (extraMin) {
    const vecchio = prima && prima[COL_STATO_EXTRA - 1];
    const vecchiExtra = prima && Number(prima[COL_EXTRA - 1]);
    // Una decisione del responsabile resta valida finché l'extra non cambia.
    statoExtra = (vecchio === EXTRA_OK || vecchio === EXTRA_NO) && vecchiExtra === round2_(extraMin / 60) ? vecchio : EXTRA_ATTESA;
  }

  const row = [s.id, nome, giorno, s.site || '', start, end, ore, s.end ? 'Chiuso' : 'In corso', user && user.device || '', new Date(),
    extraMin ? round2_(extraMin / 60) : '', extraMin ? motivo : '', extraMin ? nota : '', statoExtra];
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else { sh.appendRow(row); r = sh.getLastRow(); }
  sh.getRange(r, 3).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r, 5, 1, 2).setNumberFormat('HH:mm');
  sh.getRange(r, 7).setNumberFormat('0.00');
  sh.getRange(r, 10).setNumberFormat('dd/mm/yyyy HH:mm');
  sh.getRange(r, COL_EXTRA).setNumberFormat('0.00');
}

function extraInAttesa_() {
  const sh = foglio_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues()
    .filter(r => r[COL_STATO_EXTRA - 1] === EXTRA_ATTESA)
    .map(r => ({ id: String(r[0]), dip: String(r[1]), cantiere: String(r[3]),
      start: r[4] instanceof Date ? r[4].getTime() : null, end: r[5] instanceof Date ? r[5].getTime() : null,
      extra: Number(r[COL_EXTRA - 1]) || 0, motivo: String(r[COL_MOTIVO - 1]), nota: String(r[COL_NOTA - 1]) }))
    .sort((a, b) => a.start - b.start);
}

function decidiExtra_(id, ok) {
  const sh = foglio_();
  const r = trovaRiga_(sh, id);
  if (r) sh.getRange(r, COL_STATO_EXTRA).setValue(ok ? EXTRA_OK : EXTRA_NO);
}

function remove_(id) {
  const sh = foglio_();
  const r = trovaRiga_(sh, id);
  if (r) sh.deleteRow(r);
}

// ---------- Riepilogo mensile ----------

function onOpen() {
  try { menu_(); } catch (e) { /* il menu compare solo se il foglio lo consente */ }
}
function menu_() {
  SpreadsheetApp.getUi().createMenu('Timbra Cantieri')
    .addItem('Riepilogo mese in corso', 'riepilogoMeseCorrente')
    .addItem('Riepilogo mese scorso', 'riepilogoMeseScorso')
    .addItem('Invia ora il riepilogo del mese scorso', 'inviaRiepilogoMeseScorso')
    .addSeparator()
    .addItem('Attiva invio automatico il 1° del mese', 'attivaInvioAutomatico')
    .addToUi();
}

function riepilogoMeseCorrente() {
  const d = new Date();
  creaRiepilogo_(d.getFullYear(), d.getMonth());
}
function riepilogoMeseScorso() {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  creaRiepilogo_(d.getFullYear(), d.getMonth());
}

/** Crea (o ricrea) il foglio "Riepilogo AAAA-MM". Restituisce i dati per l'email. */
function creaRiepilogo_(anno, mese) {
  const ss = ss_();
  const sh = foglio_();
  const da = new Date(anno, mese, 1), a = new Date(anno, mese + 1, 1);
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const nomeMese = MESI[mese] + ' ' + anno;
  const dati = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues() : [];

  // Ogni turno chiuso vale ORE_TURNO ore fisse; gli extra contano solo se autorizzati.
  const perDip = {};
  const cantieri = new Set();
  dati.forEach(r => {
    const dip = r[1], giorno = r[2], cantiere = r[3], stato = r[7];
    if (!(giorno instanceof Date) || giorno < da || giorno >= a) return;
    const p = perDip[dip] || (perDip[dip] = { turni: 0, giorni: new Set(), cantieri: {}, aperti: 0, extraOk: 0, extraAttesa: 0, extraNo: 0 });
    if (stato !== 'Chiuso') { p.aperti++; return; }
    p.turni++;
    p.giorni.add(giorno.getTime());
    p.cantieri[cantiere] = (p.cantieri[cantiere] || 0) + 1;
    cantieri.add(cantiere);
    const extra = Number(r[COL_EXTRA - 1]) || 0;
    const se = r[COL_STATO_EXTRA - 1];
    if (se === EXTRA_OK) p.extraOk += extra;
    else if (se === EXTRA_ATTESA) p.extraAttesa += extra;
    else if (se === EXTRA_NO) p.extraNo += extra;
  });

  const listaCantieri = Array.from(cantieri).sort();
  const nomi = Object.keys(perDip).sort();
  const intest = ['Dipendente', 'Giorni', 'Turni', 'Ore turni (' + ORE_TURNO + 'h)', 'Extra autorizzati', 'TOTALE ORE',
    'Extra da autorizzare', 'Extra non autorizzati', 'Turni non chiusi'].concat(listaCantieri.map(c => c + ' (turni)'));
  const righe = nomi.map(n => {
    const p = perDip[n];
    const base = p.turni * ORE_TURNO;
    return [n, p.giorni.size, p.turni, base, round2_(p.extraOk), round2_(base + p.extraOk),
      round2_(p.extraAttesa), round2_(p.extraNo), p.aperti].concat(listaCantieri.map(c => p.cantieri[c] || 0));
  });
  const somma = i => round2_(righe.reduce((t, r) => t + (Number(r[i]) || 0), 0));
  const totale = ['TOTALE', '', somma(2), somma(3), somma(4), somma(5), somma(6), somma(7), somma(8)]
    .concat(listaCantieri.map((c, i) => somma(9 + i)));

  const titolo = 'Riepilogo ' + anno + '-' + ('0' + (mese + 1)).slice(-2);
  let out = ss.getSheetByName(titolo);
  if (out) out.clear(); else out = ss.insertSheet(titolo);
  out.getRange(1, 1).setValue('Riepilogo ore – ' + nomeMese).setFontWeight('bold').setFontSize(14);
  out.getRange(3, 1, 1, intest.length).setValues([intest]).setFontWeight('bold').setBackground('#e7f2ea');
  if (righe.length) out.getRange(4, 1, righe.length, intest.length).setValues(righe);
  out.getRange(4 + righe.length, 1, 1, intest.length).setValues([totale]).setFontWeight('bold');
  out.getRange(4, 4, righe.length + 1, 5).setNumberFormat('0.00');
  out.getRange(3, 6, righe.length + 2, 1).setFontWeight('bold');
  out.setFrozenRows(3);
  out.autoResizeColumns(1, intest.length);
  
  return { titolo, nomeMese, intest, righe, totale, sheetId: out.getSheetId() };
}

function round2_(n) { return Math.round(n * 100) / 100; }

function inviaRiepilogoMeseScorso() {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  inviaRiepilogo_(d.getFullYear(), d.getMonth());
}

function inviaRiepilogo_(anno, mese) {
  const r = creaRiepilogo_(anno, mese);
  const ss = ss_();
  const link = ss.getUrl() + '#gid=' + r.sheetId;

  const td = 'style="border:1px solid #ddd;padding:6px 10px"';
  const tabella = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    '<tr>' + r.intest.map(h => '<th ' + td + ' bgcolor="#e7f2ea">' + h + '</th>').join('') + '</tr>' +
    r.righe.concat([r.totale]).map(row => '<tr>' + row.map(v => '<td ' + td + '>' + (typeof v === 'number' ? String(v).replace('.', ',') : v) + '</td>').join('') + '</tr>').join('') +
    '</table>';

  // Allegato Excel del foglio riepilogo
  SpreadsheetApp.flush();
  const xlsx = esporta_(r.sheetId, 'xlsx').setName(r.titolo + '.xlsx');

  MailApp.sendEmail({
    to: EMAIL_RESPONSABILE || Session.getEffectiveUser().getEmail(),
    subject: 'GE3CO – Ore del personale – ' + r.nomeMese,
    htmlBody: '<p>Riepilogo ore del personale di <b>' + r.nomeMese + '</b>.</p>' + tabella +
      '<p>Dettaglio di tutte le timbrature: <a href="' + link + '">apri il Google Sheet</a></p>' +
      '<p>Ogni turno vale ' + ORE_TURNO + ' ore; le ore extra contano solo se autorizzate.</p>' +
      (r.righe.some(x => x[8] > 0) ? '<p><b>Attenzione:</b> alcuni turni risultano non chiusi (uscita mancante).</p>' : '') +
      (r.righe.some(x => x[6] > 0) ? '<p><b>Attenzione:</b> ci sono ore extra ancora da autorizzare.</p>' : ''),
    attachments: [xlsx],
  });
}

/** Esegui una volta: invia il riepilogo ogni 1° del mese alle 7. */
function attivaInvioAutomatico() {
  configura();
  ss_().toast('Invio automatico attivo: il 1° di ogni mese alle 7.');
}
