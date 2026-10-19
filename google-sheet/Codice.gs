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

const FOGLIO_TIMBRATURE = 'Timbrature';
const INTESTAZIONE = ['ID', 'Dipendente', 'Data', 'Cantiere', 'Entrata', 'Uscita', 'Ore', 'Stato', 'Telefono', 'Aggiornato'];

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
  if (e && e.parameter && e.parameter.azione === 'cantieri') return json_({ ok: true, cantieri: cantieri_() });
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
    case 'cambiapassword': {
      const nuova = String(req.nuova || '');
      if (nuova.length < 6) return { ok: false, msg: 'La password deve avere almeno 6 caratteri.' };
      props.setProperty('PASSWORD_ADMIN', nuova);
      return { ok: true };
    }
    default: return { ok: true, cantieri: tuttiCantieri_() };
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
      start: r[4].getTime(), end: r[5] instanceof Date ? r[5].getTime() : null }))
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
  const row = [s.id, nome, giorno, s.site || '', start, end, ore, s.end ? 'Chiuso' : 'In corso', user && user.device || '', new Date()];
  let r = trovaRiga_(sh, s.id);
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else { sh.appendRow(row); r = sh.getLastRow(); }
  sh.getRange(r, 3).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r, 5, 1, 2).setNumberFormat('HH:mm');
  sh.getRange(r, 7).setNumberFormat('0.00');
  sh.getRange(r, 10).setNumberFormat('dd/mm/yyyy HH:mm');
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

  // dipendente -> { ore, giorni:Set, cantieri:{nome:ore}, aperti }
  const perDip = {};
  const cantieri = new Set();
  dati.forEach(r => {
    const [, dip, giorno, cantiere, , , ore, stato] = r;
    if (!(giorno instanceof Date) || giorno < da || giorno >= a) return;
    const p = perDip[dip] || (perDip[dip] = { ore: 0, giorni: new Set(), cantieri: {}, aperti: 0 });
    if (stato !== 'Chiuso') { p.aperti++; return; }
    p.ore += Number(ore) || 0;
    p.giorni.add(giorno.getTime());
    p.cantieri[cantiere] = (p.cantieri[cantiere] || 0) + (Number(ore) || 0);
    cantieri.add(cantiere);
  });

  const listaCantieri = Array.from(cantieri).sort();
  const nomi = Object.keys(perDip).sort();
  const intest = ['Dipendente', 'Giorni lavorati', 'Ore totali'].concat(listaCantieri).concat(['Turni non chiusi']);
  const righe = nomi.map(n => {
    const p = perDip[n];
    return [n, p.giorni.size, round2_(p.ore)].concat(listaCantieri.map(c => round2_(p.cantieri[c] || 0))).concat([p.aperti]);
  });
  const totale = ['TOTALE', '', round2_(righe.reduce((t, r) => t + r[2], 0))]
    .concat(listaCantieri.map((c, i) => round2_(righe.reduce((t, r) => t + r[3 + i], 0)))).concat(['']);

  const titolo = 'Riepilogo ' + anno + '-' + ('0' + (mese + 1)).slice(-2);
  let out = ss.getSheetByName(titolo);
  if (out) out.clear(); else out = ss.insertSheet(titolo);
  out.getRange(1, 1).setValue('Riepilogo ore – ' + nomeMese).setFontWeight('bold').setFontSize(14);
  out.getRange(3, 1, 1, intest.length).setValues([intest]).setFontWeight('bold').setBackground('#e7f2ea');
  if (righe.length) out.getRange(4, 1, righe.length, intest.length).setValues(righe);
  out.getRange(4 + righe.length, 1, 1, intest.length).setValues([totale]).setFontWeight('bold');
  out.getRange(4, 3, righe.length + 1, intest.length - 2).setNumberFormat('0.00');
  out.getRange(4, intest.length, righe.length + 1, 1).setNumberFormat('0');
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
      (r.righe.some(x => x[x.length - 1] > 0) ? '<p><b>Attenzione:</b> alcuni turni risultano non chiusi (uscita mancante).</p>' : ''),
    attachments: [xlsx],
  });
}

/** Esegui una volta: invia il riepilogo ogni 1° del mese alle 7. */
function attivaInvioAutomatico() {
  configura();
  ss_().toast('Invio automatico attivo: il 1° di ogni mese alle 7.');
}
