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
  const r = creaRiepilogo_(d.getFullYear(), d.getMonth());
  const ss = ss_();
  const link = ss.getUrl() + '#gid=' + r.sheetId;

  const td = 'style="border:1px solid #ddd;padding:6px 10px"';
  const tabella = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    '<tr>' + r.intest.map(h => '<th ' + td + ' bgcolor="#e7f2ea">' + h + '</th>').join('') + '</tr>' +
    r.righe.concat([r.totale]).map(row => '<tr>' + row.map(v => '<td ' + td + '>' + (typeof v === 'number' ? String(v).replace('.', ',') : v) + '</td>').join('') + '</tr>').join('') +
    '</table>';

  // Allegato Excel del foglio riepilogo
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx&gid=' + r.sheetId;
  const xlsx = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } })
    .getBlob().setName(r.titolo + '.xlsx');

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
