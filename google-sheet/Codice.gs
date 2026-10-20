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
// Fasce orarie dei turni (ora di inizio della timbratura -> fascia)
const TURNI = [
  { nome: 'Mattina', inizio: '05:00', fine: '11:00' },
  { nome: 'Pomeriggio', inizio: '13:00', fine: '18:00' },
];
// Chi autorizza le ore extra (riceve la richiesta su WhatsApp). Telefono con prefisso, senza + né spazi.
const AUTORIZZA_NOME = 'INSERISCI_NOME';
const AUTORIZZA_TELEFONO = 'INSERISCI_TELEFONO';

// Sede: si timbra solo entro RAGGIO metri. Il responsabile può ricentrarla dall'app (Area responsabile → Sede).
const SEDE_PREDEFINITA = { nome: 'Sede GE3CO – Via G. Ferraris 7, Pisa', lat: 43.6790219, lng: 10.4356678, raggio: 200 };

const FOGLIO_TIMBRATURE = 'Timbrature';
const INTESTAZIONE = ['ID', 'Dipendente', 'Data', 'Cantiere', 'Entrata', 'Uscita', 'Ore', 'Stato', 'Telefono', 'Aggiornato',
  'Extra (ore)', 'Motivo extra', 'Nota extra', 'Stato extra', 'Posizione entrata', 'Posizione uscita', 'Turno', 'Controllo sede'];
// Indici (base 1) delle colonne extra e posizione
const COL_EXTRA = 11, COL_MOTIVO = 12, COL_NOTA = 13, COL_STATO_EXTRA = 14, COL_POS_IN = 15, COL_POS_OUT = 16, COL_TURNO = 17, COL_SEDE = 18;

// Assenze (ferie, permessi, malattia)
const FOGLIO_ASSENZE = 'Assenze';
const INTEST_ASSENZE = ['ID', 'Dipendente', 'Tipo', 'Dal', 'Al', 'Giorni', 'Ore permesso', 'Nota', 'Stato', 'Richiesta il', 'Telefono'];
const ASS_ATTESA = 'Da approvare', ASS_OK = 'Approvata', ASS_NO = 'Rifiutata';
const EXTRA_ATTESA = 'Da autorizzare', EXTRA_OK = 'Autorizzato', EXTRA_NO = 'Non autorizzato';

function ss_() { return SpreadsheetApp.openById(ID_FOGLIO); }

/** Esegui UNA volta dall'editor: crea il menu nel foglio e l'invio automatico il 1° del mese. */
function configura() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ID_FOGLIO).onOpen().create();
  ScriptApp.newTrigger('inviaRiepilogoMeseScorso').timeBased().onMonthDay(1).atHour(7).create();
  ScriptApp.newTrigger('avvisoSerale').timeBased().everyDays(1).atHour(20).create();
  foglio_();
  foglioCantieri_();
  foglioAssenze_();
}

// ---------- Ricezione dall'app ----------

// ---------- Codice di accesso ----------
// Finché non è attivo l'app funziona come prima. Dopo "attivaCodiceAccesso" lo script accetta solo
// i telefoni che hanno aperto il link di invito (Area responsabile → Link di invito).
function codiceOk_(c) {
  const giusto = PropertiesService.getScriptProperties().getProperty('CODICE_ACCESSO');
  return !giusto || String(c || '') === giusto;
}
/** Esegui una volta (o di nuovo per cambiarlo): crea il codice e scrive il link di invito nel registro di esecuzione. */
function attivaCodiceAccesso() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let c = '';
  for (let i = 0; i < 16; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
  PropertiesService.getScriptProperties().setProperty('CODICE_ACCESSO', c);
  Logger.log('Codice attivo. Link di invito: https://grandoniandrea.github.io/timbra-cantieri/?codice=' + c);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.admin) return json_(admin_(body.admin));
    if (!codiceOk_(body.codice)) return json_({ ok: false, error: 'codice' });
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const ok = [];
    ops.forEach(op => {
      if (op.type === 'upsert') upsert_(op.shift, body.user);
      else if (op.type === 'delete') remove_(op.id);
      else if (op.type === 'assenza') salvaAssenza_(op.assenza, body.user);
      else if (op.type === 'intervento') chiudiIntervento_(op.intervento, body.user);
      ok.push(op.opId);
    });
    try { avvisiImmediati(); } catch (err) { /* l'avviso non deve bloccare la timbratura */ }
    return json_({ ok: true, done: ok });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Apri l'URL della web app nel browser per verificare che funzioni.
function doGet(e) {
  if (e && e.parameter && e.parameter.azione && !codiceOk_(e.parameter.codice)) return json_({ ok: false, error: 'codice' });
  if (e && e.parameter && e.parameter.azione === 'programma') return json_(programmaPubblico_(e));
  if (e && e.parameter && e.parameter.azione === 'interventi') return json_(interventiPubblico_(e));
  if (e && e.parameter && e.parameter.azione === 'fotointervento') {
    return json_({ ok: true, foto: fotoIntervento_(String(e.parameter.id || ''), String(e.parameter.tipo || '')) });
  }
  if (e && e.parameter && e.parameter.azione === 'assenze') {
    return json_({ ok: true, assenze: assenze_().filter(a => a.device && a.device === String(e.parameter.device || '')) });
  }
  if (e && e.parameter && e.parameter.azione === 'cantieri') {
    return json_({ ok: true, cantieri: cantieri_(), colori: colori_(), config: {
      oreTurno: ORE_TURNO, tolleranzaMin: TOLLERANZA_MIN, turni: TURNI, sede: sede_(),
      autorizzaNome: AUTORIZZA_NOME.indexOf('INSERISCI') === 0 ? '' : AUTORIZZA_NOME,
      autorizzaTelefono: AUTORIZZA_TELEFONO.indexOf('INSERISCI') === 0 ? '' : AUTORIZZA_TELEFONO,
      resetAt: Number(PropertiesService.getScriptProperties().getProperty('RESET_AT') || 0),
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
  if (sh.getRange(1, 3).getValue() !== 'Colore') {
    sh.getRange(1, 3).setValue('Colore').setFontWeight('bold').setBackground('#e7f2ea');
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
      const r = req.tipo === 'comuni' ? creaComuni_(anno, mese) : creaRiepilogo_(anno, mese);
      return { ok: true, nomeMese: r.nomeMese, intest: r.intest, righe: r.righe, totale: r.totale };
    }
    case 'pdf': {
      const r = req.tipo === 'comuni' ? creaComuni_(anno, mese) : creaRiepilogo_(anno, mese);
      SpreadsheetApp.flush();
      const blob = esporta_(r.sheetId, 'pdf');
      return { ok: true, nome: 'GE3CO ' + r.titolo + '.pdf', base64: Utilities.base64Encode(blob.getBytes()) };
    }
    case 'email': inviaRiepilogo_(anno, mese); return { ok: true };
    case 'timbrature': return { ok: true, timbrature: timbratureMese_(anno, mese), cantieri: tuttiCantieri_() };
    case 'modifica': modificaTimbratura_(req.t); return { ok: true };
    case 'elimina': remove_(req.id); return { ok: true };
    case 'extra': return { ok: true, extra: extraInAttesa_() };
    case 'codice': return { ok: true, codice: PropertiesService.getScriptProperties().getProperty('CODICE_ACCESSO') || '' };
    case 'programma': return { ok: true, squadre: programma_(req.da, req.a), operatori: operatori_(), cantieri: tuttiCantieri_() };
    case 'salvaprogramma': salvaProgramma_(req.da, req.a, req.squadre);
      return { ok: true, squadre: programma_(req.da, req.a), operatori: operatori_(), cantieri: tuttiCantieri_() };
    case 'operatori': salvaOperatori_(req.operatori); return { ok: true, operatori: operatori_() };
    case 'interventi': return { ok: true, interventi: interventi_(), operatori: operatori_() };
    case 'salvaintervento': salvaIntervento_(req.intervento); return { ok: true, interventi: interventi_(), operatori: operatori_() };
    case 'eliminaintervento': eliminaIntervento_(req.id); return { ok: true, interventi: interventi_(), operatori: operatori_() };
    case 'riapriintervento': riapriIntervento_(req.id); return { ok: true, interventi: interventi_(), operatori: operatori_() };
    case 'fotointervento': return { ok: true, foto: fotoIntervento_(req.id, req.tipo) };
    case 'azzera': azzera_(); return { ok: true };
    case 'sede': impostaSede_(req.sede); return { ok: true, sede: sede_() };
    case 'assenze': return { ok: true, assenze: assenze_() };
    case 'decidiassenza': decidiAssenza_(req.id, !!req.approva); return { ok: true, assenze: assenze_() };
    case 'decidi': decidiExtra_(req.id, !!req.approva); return { ok: true, extra: extraInAttesa_() };
    case 'cambiapassword': {
      const nuova = String(req.nuova || '');
      if (nuova.length < 6) return { ok: false, msg: 'La password deve avere almeno 6 caratteri.' };
      props.setProperty('PASSWORD_ADMIN', nuova);
      return { ok: true };
    }
    default: return { ok: true, cantieri: tuttiCantieri_(), extraInAttesa: extraInAttesa_().length,
      codice: PropertiesService.getScriptProperties().getProperty('CODICE_ACCESSO') || '',
      assenzeInAttesa: assenze_().filter(a => a.stato === ASS_ATTESA).length };
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
      extra: Number(r[COL_EXTRA - 1]) || 0, statoExtra: String(r[COL_STATO_EXTRA - 1] || ''),
      posIn: String(r[COL_POS_IN - 1] || ''), posOut: String(r[COL_POS_OUT - 1] || ''),
      turno: String(r[COL_TURNO - 1] || turno_(r[4])), sede: String(r[COL_SEDE - 1] || '') }))
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
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => String(r[0]).trim())
    .map(r => ({ nome: String(r[0]).trim().toUpperCase(), attivo: String(r[1]).trim().toUpperCase() !== 'NO', colore: coloreValido_(r[2]) }));
}

function salvaCantieri_(lista) {
  if (!Array.isArray(lista)) return;
  const righe = [];
  const visti = {};
  lista.forEach(c => {
    const nome = String(c && c.nome || '').trim().toUpperCase().slice(0, 60);
    if (!nome || visti[nome]) return;
    visti[nome] = true;
    righe.push([nome, c.attivo === false ? 'NO' : 'SI', coloreValido_(c.colore)]);
  });
  const sh = foglioCantieri_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent().setBackground(null);
  if (righe.length) {
    sh.getRange(2, 1, righe.length, 3).setValues(righe);
    // Colora la cella così il colore si vede anche nel foglio
    sh.getRange(2, 3, righe.length, 1).setBackgrounds(righe.map(r => [r[2] || null]));
  }
}

function coloreValido_(c) {
  const v = String(c || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '';
}

/** Colori scelti dal responsabile, per nome cantiere (solo quelli impostati). */
function colori_() {
  const out = {};
  tuttiCantieri_().forEach(c => { if (c.colore) out[c.nome] = c.colore; });
  return out;
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

  const posIn = mappa_(s.posIn) || (prima && prima[COL_POS_IN - 1]) || '';
  const posOut = s.end ? (mappa_(s.posOut) || (prima && prima[COL_POS_OUT - 1]) || '') : '';
  const row = [s.id, nome, giorno, s.site || '', start, end, ore, s.end ? 'Chiuso' : 'In corso', user && user.device || '', new Date(),
    extraMin ? round2_(extraMin / 60) : '', extraMin ? motivo : '', extraMin ? nota : '', statoExtra, posIn, posOut, turno_(start),
    controlloSede_(s, prima)];
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else { sh.appendRow(row); r = sh.getLastRow(); }
  sh.getRange(r, 3).setNumberFormat('dd/mm/yyyy');
  sh.getRange(r, 5, 1, 2).setNumberFormat('HH:mm');
  sh.getRange(r, 7).setNumberFormat('0.00');
  sh.getRange(r, 10).setNumberFormat('dd/mm/yyyy HH:mm');
  sh.getRange(r, COL_EXTRA).setNumberFormat('0.00');
}

/**
 * "Parti da zero": sposta tutte le timbrature nel foglio "Archivio prove" (non si perdono),
 * toglie i riepiloghi e segna l'ora dell'azzeramento: i telefoni cancellano le timbrature locali precedenti.
 */
function azzera_() {
  const ss = ss_();
  const sh = foglio_();
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    let arch = ss.getSheetByName('Archivio prove');
    if (!arch) {
      arch = ss.insertSheet('Archivio prove');
      arch.appendRow(['Archiviato il'].concat(INTESTAZIONE));
      arch.getRange(1, 1, 1, INTESTAZIONE.length + 1).setFontWeight('bold');
    }
    const quando = new Date();
    const righe = sh.getRange(2, 1, n, INTESTAZIONE.length).getValues().map(r => [quando].concat(r));
    arch.getRange(arch.getLastRow() + 1, 1, righe.length, righe[0].length).setValues(righe);
    arch.hideSheet();
    sh.deleteRows(2, n);
  }
  ss.getSheets().filter(x => /^(Riepilogo|Comuni) /.test(x.getName())).forEach(x => ss.deleteSheet(x));
  const shA = foglioAssenze_();
  if (shA.getLastRow() > 1) shA.deleteRows(2, shA.getLastRow() - 1);
  const vuoto = ss.getSheetByName('Foglio1');
  if (vuoto && vuoto.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(vuoto);
  PropertiesService.getScriptProperties().setProperty('RESET_AT', String(Date.now()));
}

// Fascia del turno dall'ora di entrata: dall'inizio della mattina (5:00) alle 12 mattina, dalle 12 alle 21 pomeriggio
function turno_(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  const inizioMattina = Number(TURNI[0].inizio.slice(0, 2)) + Number(TURNI[0].inizio.slice(3, 5)) / 60;
  if (h >= inizioMattina && h < 12) return TURNI[0].nome;
  if (h >= 12 && h < 21) return TURNI[1].nome;
  return 'Fuori orario';
}

function sede_() {
  const v = PropertiesService.getScriptProperties().getProperty('SEDE');
  try { if (v) return Object.assign({}, SEDE_PREDEFINITA, JSON.parse(v)); } catch (e) { /* valore non valido */ }
  return SEDE_PREDEFINITA;
}

function impostaSede_(x) {
  const lat = Number(x && x.lat), lng = Number(x && x.lng), raggio = Math.round(Number(x && x.raggio) || 0);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Posizione non valida');
  if (raggio < 50 || raggio > 2000) throw new Error('Raggio non valido');
  PropertiesService.getScriptProperties().setProperty('SEDE', JSON.stringify({ lat, lng, raggio }));
}

// Distanza in metri tra due punti (formula dell'emisenoverso)
function distanza_(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Esito del controllo sede per una posizione: '' se ok, altrimenti il problema
function fuoriSede_(p, quando) {
  if (!p) return '';
  if (p.errore) return quando + ' senza posizione';
  const sede = sede_();
  const d = distanza_(sede, p);
  const margine = Math.min(Number(p.acc) || 0, 100);
  return d > sede.raggio + margine ? quando + ' a ' + (d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(d) + ' m') + ' dalla sede' : '';
}

// Posizione GPS -> link a Google Maps (o il motivo per cui manca)
function mappa_(p) {
  if (!p) return '';
  if (p.errore) return 'Non disponibile (' + String(p.errore).slice(0, 40) + ')';
  const lat = Number(p.lat), lng = Number(p.lng);
  if (!isFinite(lat) || !isFinite(lng)) return '';
  return 'https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) + (p.acc ? ' (±' + Math.round(p.acc) + ' m)' : '');
}

function controlloSede_(s, prima) {
  if (s.demo) return 'PROVA (modalità prova del responsabile)';
  if (!s.posIn && !s.posOut) return (prima && prima[COL_SEDE - 1]) || '';
  const problemi = [fuoriSede_(s.posIn, 'Entrata'), s.end ? fuoriSede_(s.posOut, 'Uscita') : ''].filter(Boolean);
  return problemi.length ? 'FUORI SEDE: ' + problemi.join('; ') : 'OK';
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
  const nomeMese = MESI_[mese] + ' ' + anno;
  const dati = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues() : [];

  // Ogni turno chiuso vale ORE_TURNO ore fisse; gli extra contano solo se autorizzati.
  const perDip = {};
  const cantieri = new Set();
  dati.forEach(r => {
    const dip = r[1], giorno = r[2], cantiere = r[3], stato = r[7];
    if (!(giorno instanceof Date) || giorno < da || giorno >= a) return;
    const p = perDip[dip] || (perDip[dip] = { turni: 0, giorni: new Set(), cantieri: {}, aperti: 0, extraOk: 0, extraAttesa: 0, extraNo: 0, mattine: 0, pomeriggi: 0 });
    if (stato !== 'Chiuso') { p.aperti++; return; }
    p.turni++;
    const fascia = r[COL_TURNO - 1] || (r[4] instanceof Date ? turno_(r[4]) : '');
    if (fascia === TURNI[0].nome) p.mattine++; else if (fascia === TURNI[1].nome) p.pomeriggi++;
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
  // Assenze approvate nel mese
  const ass = assenzeMese_(anno, mese);
  Object.keys(ass).forEach(n => { if (!perDip[n]) perDip[n] = { turni: 0, giorni: new Set(), cantieri: {}, aperti: 0, extraOk: 0, extraAttesa: 0, extraNo: 0, mattine: 0, pomeriggi: 0 }; });
  const nomiTutti = Object.keys(perDip).sort();
  const intest = ['Dipendente', 'Giorni', 'Turni', 'Ore turni (' + ORE_TURNO + 'h)', 'Extra autorizzati', 'TOTALE ORE',
    'Extra da autorizzare', 'Extra non autorizzati', 'Turni non chiusi', 'Giorni ferie', 'Ore permesso', 'Giorni malattia',
    'Turni mattina', 'Turni pomeriggio']
    .concat(listaCantieri.map(c => c + ' (turni)'));
  const righe = nomiTutti.map(n => {
    const p = perDip[n], a = ass[n] || { ferie: 0, permesso: 0, malattia: 0 };
    const base = p.turni * ORE_TURNO;
    return [n, p.giorni.size, p.turni, base, round2_(p.extraOk), round2_(base + p.extraOk),
      round2_(p.extraAttesa), round2_(p.extraNo), p.aperti, a.ferie, round2_(a.permesso), a.malattia, p.mattine, p.pomeriggi]
      .concat(listaCantieri.map(c => p.cantieri[c] || 0));
  });
  const somma = i => round2_(righe.reduce((t, r) => t + (Number(r[i]) || 0), 0));
  const totale = ['TOTALE', '', somma(2), somma(3), somma(4), somma(5), somma(6), somma(7), somma(8), somma(9), somma(10), somma(11), somma(12), somma(13)]
    .concat(listaCantieri.map((c, i) => somma(14 + i)));

  const titolo = 'Riepilogo ' + anno + '-' + ('0' + (mese + 1)).slice(-2);
  const out = scriviTabella_(titolo, 'Riepilogo ore – ' + nomeMese, intest, righe, totale, [4, 5, 6, 7, 8, 11]);
  out.getRange(3, 6, righe.length + 2, 1).setFontWeight('bold');
  return { titolo, nomeMese, intest, righe, totale, sheetId: out.getSheetId() };
}

function round2_(n) { return Math.round(n * 100) / 100; }

const MESI_ = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Scrive una tabella di riepilogo in un foglio (lo ricrea da zero). */
function scriviTabella_(titolo, intestazione, intest, righe, totale, colOre) {
  const ss = ss_();
  let out = ss.getSheetByName(titolo);
  if (out) out.clear(); else out = ss.insertSheet(titolo);
  out.getRange(1, 1).setValue(intestazione).setFontWeight('bold').setFontSize(14);
  out.getRange(3, 1, 1, intest.length).setValues([intest]).setFontWeight('bold').setBackground('#e7f2ea');
  if (righe.length) out.getRange(4, 1, righe.length, intest.length).setValues(righe);
  out.getRange(4 + righe.length, 1, 1, intest.length).setValues([totale]).setFontWeight('bold');
  colOre.forEach(c => out.getRange(4, c, righe.length + 1, 1).setNumberFormat('0.00'));
  out.setFrozenRows(3);
  out.autoResizeColumns(1, intest.length);
  return out;
}

/** Riepilogo per comune/cantiere: servizi, ore, operatori (utile per la fatturazione). */
function creaComuni_(anno, mese) {
  const sh = foglio_();
  const da = new Date(anno, mese, 1), a = new Date(anno, mese + 1, 1);
  const nomeMese = MESI_[mese] + ' ' + anno;
  const dati = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues() : [];
  const per = {};
  dati.forEach(r => {
    const dip = r[1], giorno = r[2], cantiere = r[3], stato = r[7];
    if (!(giorno instanceof Date) || giorno < da || giorno >= a || stato !== 'Chiuso') return;
    const c = per[cantiere] || (per[cantiere] = { servizi: 0, giorni: new Set(), extra: 0, operatori: new Set() });
    c.servizi++;
    c.giorni.add(giorno.getTime());
    c.operatori.add(dip);
    if (r[COL_STATO_EXTRA - 1] === EXTRA_OK) c.extra += Number(r[COL_EXTRA - 1]) || 0;
  });
  const intest = ['Comune / cantiere', 'Giorni di servizio', 'Servizi (turni)', 'Ore turni (' + ORE_TURNO + 'h)', 'Extra autorizzati', 'TOTALE ORE', 'Operatori'];
  const righe = Object.keys(per).sort().map(n => {
    const c = per[n], base = c.servizi * ORE_TURNO;
    return [n, c.giorni.size, c.servizi, base, round2_(c.extra), round2_(base + c.extra), Array.from(c.operatori).sort().join(', ')];
  });
  const somma = i => round2_(righe.reduce((t, r) => t + (Number(r[i]) || 0), 0));
  const totale = ['TOTALE', somma(1), somma(2), somma(3), somma(4), somma(5), ''];
  const titolo = 'Comuni ' + anno + '-' + ('0' + (mese + 1)).slice(-2);
  const out = scriviTabella_(titolo, 'Servizi per comune – ' + nomeMese, intest, righe, totale, [4, 5, 6]);
  return { titolo, nomeMese, intest, righe, totale, sheetId: out.getSheetId() };
}

// ---------- Assenze ----------

function foglioAssenze_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FOGLIO_ASSENZE);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_ASSENZE);
    sh.appendRow(INTEST_ASSENZE);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, INTEST_ASSENZE.length).setFontWeight('bold').setBackground('#e7f2ea');
    sh.hideColumns(1);
    sh.getRange('D:E').setNumberFormat('dd/mm/yyyy');
    sh.getRange('J:J').setNumberFormat('dd/mm/yyyy HH:mm');
  }
  return sh;
}

// Giorni lavorativi (lunedì–venerdì) tra due date incluse, eventualmente limitati a un mese
function giorniLavorativi_(dal, al, da, a) {
  let n = 0;
  const d = new Date(dal.getFullYear(), dal.getMonth(), dal.getDate());
  const fine = new Date(al.getFullYear(), al.getMonth(), al.getDate());
  for (; d <= fine; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (da && (d < da || d >= a)) continue;
    n++;
  }
  return n;
}

function salvaAssenza_(x, user) {
  if (!x || !x.id || !x.dal) return;
  const sh = foglioAssenze_();
  const tipo = ['Ferie', 'Permesso', 'Malattia'].indexOf(x.tipo) >= 0 ? x.tipo : 'Ferie';
  const dal = new Date(x.dal + 'T00:00:00'), al = new Date((x.al || x.dal) + 'T00:00:00');
  if (isNaN(dal) || isNaN(al) || al < dal) return;
  const ore = tipo === 'Permesso' ? Math.max(0, Math.min(24, Number(x.ore) || 0)) : '';
  const giorni = tipo === 'Permesso' ? '' : giorniLavorativi_(dal, al);
  const r = trovaRiga_(sh, x.id);
  const stato = r ? sh.getRange(r, 9).getValue() : ASS_ATTESA;
  const row = [x.id, user && user.name || 'Sconosciuto', tipo, dal, al, giorni, ore, String(x.nota || '').slice(0, 300), stato, new Date(), user && user.device || ''];
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function assenze_() {
  const sh = foglioAssenze_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, INTEST_ASSENZE.length).getValues()
    .filter(r => r[0])
    .map(r => ({ id: String(r[0]), dip: String(r[1]), tipo: String(r[2]),
      dal: r[3] instanceof Date ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      al: r[4] instanceof Date ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      giorni: Number(r[5]) || 0, ore: Number(r[6]) || 0, nota: String(r[7] || ''), stato: String(r[8] || ''),
      device: String(r[10] || '') }))
    .sort((a, b) => (a.dal < b.dal ? 1 : -1));
}

function decidiAssenza_(id, ok) {
  const sh = foglioAssenze_();
  const r = trovaRiga_(sh, id);
  if (r) sh.getRange(r, 9).setValue(ok ? ASS_OK : ASS_NO);
}

/** Assenze approvate nel mese, per dipendente: giorni ferie, ore permesso, giorni malattia. */
function assenzeMese_(anno, mese) {
  const da = new Date(anno, mese, 1), a = new Date(anno, mese + 1, 1);
  const out = {};
  const sh = foglioAssenze_();
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, INTEST_ASSENZE.length).getValues().forEach(r => {
    if (r[8] !== ASS_OK || !(r[3] instanceof Date) || !(r[4] instanceof Date)) return;
    const p = out[r[1]] || (out[r[1]] = { ferie: 0, permesso: 0, malattia: 0 });
    if (r[2] === 'Permesso') { if (r[3] >= da && r[3] < a) p.permesso += Number(r[6]) || 0; }
    else {
      const g = giorniLavorativi_(r[3], r[4], da, a);
      if (r[2] === 'Malattia') p.malattia += g; else p.ferie += g;
    }
  });
  return out;
}

// ---------- Avviso serale ----------

/** Ogni sera alle 20: email al responsabile solo se c'è qualcosa da sistemare. */
function avvisoSerale() {
  const sh = foglio_();
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const dati = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues() : [];
  const aperti = dati.filter(r => r[7] === 'In corso' && r[4] instanceof Date);
  const extra = extraInAttesa_();
  const ass = assenze_().filter(a => a.stato === ASS_ATTESA);
  const fuori = dati.filter(r => String(r[COL_SEDE - 1] || '').indexOf('FUORI SEDE') === 0 && r[4] instanceof Date && r[4] >= oggi);
  if (!aperti.length && !extra.length && !ass.length && !fuori.length) return;
  const tz = Session.getScriptTimeZone();
  const f = d => Utilities.formatDate(d, tz, 'dd/MM HH:mm');
  const li = arr => '<ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  let html = '<p>Situazione di oggi su Timbra Cantieri:</p>';
  if (aperti.length) html += '<h3>Uscite non timbrate (' + aperti.length + ')</h3>' +
    li(aperti.map(r => '<b>' + r[1] + '</b> · ' + r[3] + ' · entrata ' + f(r[4])));
  if (fuori.length) html += '<h3>Timbrature fuori sede oggi (' + fuori.length + ')</h3>' +
    li(fuori.map(r => '<b>' + r[1] + '</b> · ' + r[3] + ' · ' + f(r[4]) + ' · ' + r[COL_SEDE - 1]));
  if (extra.length) html += '<h3>Ore extra da autorizzare (' + extra.length + ')</h3>' +
    li(extra.map(x => '<b>' + x.dip + '</b> · ' + x.cantiere + ' · +' + String(x.extra).replace('.', ',') + ' h · ' + (x.motivo || '') + (x.nota ? ' – ' + x.nota : '')));
  if (ass.length) html += '<h3>Ferie e permessi da approvare (' + ass.length + ')</h3>' +
    li(ass.map(x => '<b>' + x.dip + '</b> · ' + x.tipo + ' · ' + x.dal + (x.al && x.al !== x.dal ? ' → ' + x.al : '') + (x.ore ? ' · ' + x.ore + ' h' : '')));
  html += '<p>Si sistemano dall\'app: tieni premuto il logo GE3CO → Area responsabile.</p>';
  MailApp.sendEmail({
    to: EMAIL_RESPONSABILE || Session.getEffectiveUser().getEmail(),
    subject: 'GE3CO – Da sistemare oggi (' + (aperti.length + extra.length + ass.length + fuori.length) + ')',
    htmlBody: html,
  });
}

function inviaRiepilogoMeseScorso() {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  inviaRiepilogo_(d.getFullYear(), d.getMonth());
}

function tabellaHtml_(r) {
  const td = 'style="border:1px solid #ddd;padding:6px 10px"';
  return '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    '<tr>' + r.intest.map(h => '<th ' + td + ' bgcolor="#e7f2ea">' + h + '</th>').join('') + '</tr>' +
    r.righe.concat([r.totale]).map(row => '<tr>' + row.map(v => '<td ' + td + '>' + (typeof v === 'number' ? String(v).replace('.', ',') : v) + '</td>').join('') + '</tr>').join('') +
    '</table>';
}

function inviaRiepilogo_(anno, mese) {
  const r = creaRiepilogo_(anno, mese);
  const c = creaComuni_(anno, mese);
  const ss = ss_();
  const link = ss.getUrl() + '#gid=' + r.sheetId;
  const tabella = tabellaHtml_(r) + '<h3>Servizi per comune</h3>' + tabellaHtml_(c);

  // Allegati Excel dei due riepiloghi
  SpreadsheetApp.flush();
  const xlsx = esporta_(r.sheetId, 'xlsx').setName(r.titolo + '.xlsx');
  const xlsxC = esporta_(c.sheetId, 'xlsx').setName(c.titolo + '.xlsx');

  MailApp.sendEmail({
    to: EMAIL_RESPONSABILE || Session.getEffectiveUser().getEmail(),
    subject: 'GE3CO – Ore del personale – ' + r.nomeMese,
    htmlBody: '<p>Riepilogo ore del personale di <b>' + r.nomeMese + '</b>.</p>' + tabella +
      '<p>Dettaglio di tutte le timbrature: <a href="' + link + '">apri il Google Sheet</a></p>' +
      '<p>Ogni turno vale ' + ORE_TURNO + ' ore; le ore extra contano solo se autorizzate.</p>' +
      (r.righe.some(x => x[8] > 0) ? '<p><b>Attenzione:</b> alcuni turni risultano non chiusi (uscita mancante).</p>' : '') +
      (r.righe.some(x => x[6] > 0) ? '<p><b>Attenzione:</b> ci sono ore extra ancora da autorizzare.</p>' : ''),
    attachments: [xlsx, xlsxC],
  });
}

/** Esegui una volta: invia il riepilogo ogni 1° del mese alle 7. */
function attivaInvioAutomatico() {
  configura();
  Logger.log('Invio automatico attivo: il 1° di ogni mese alle 7.'); // toast() non funziona in uno script autonomo
}

// ---------- Avvisi immediati al responsabile ----------
// Un'email per ogni problema, appena succede. Solo l'operatore che ha il problema, non tutti.
//   - timbratura fuori sede            → subito
//   - timbratura in modalità prova     → subito
//   - ore extra da autorizzare         → subito (guasto, foratura, incidente…)
//   - ferie / permesso / malattia      → subito
//   - uscita dimenticata               → dopo ORE_USCITA_DIMENTICATA ore dall'entrata (controllo ogni ora)
// Ogni problema viene avvisato UNA volta sola.
// Attivazione: esegui UNA volta la funzione attivaAvvisiImmediati dall'editor.

// Dopo quante ore dall'entrata, senza uscita, l'uscita si considera dimenticata.
const ORE_USCITA_DIMENTICATA = ORE_TURNO + 1;
// Si guardano solo le timbrature degli ultimi giorni.
const GIORNI_AVVISI = 7;

/** Esegui UNA volta: controllo ogni ora. I problemi già presenti adesso non vengono rimandati. */
function attivaAvvisiImmediati() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'avvisiImmediati')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('avvisiImmediati').timeBased().everyHours(1).create();
  avvisiImmediati(true);
  Logger.log('Avvisi immediati attivi: controllo ogni ora.'); // toast() non funziona in uno script autonomo
}

function avvisiImmediati(soloSegna) {
  const props = PropertiesService.getScriptProperties();
  let visti = [];
  try { visti = JSON.parse(props.getProperty('AVVISI_INVIATI') || '[]'); } catch (e) { visti = []; }
  const giaVisto = new Set(visti);
  const tz = Session.getScriptTimeZone();
  const f = d => Utilities.formatDate(d, tz, 'dd/MM HH:mm');
  const ora = Date.now();
  const limite = ora - GIORNI_AVVISI * 864e5;
  const nuovi = [];
  const aggiungi = (chiave, titolo, dip, testo) => {
    if (giaVisto.has(chiave)) return;
    giaVisto.add(chiave);
    visti.push(chiave);
    nuovi.push({ titolo: titolo, dip: dip, testo: testo });
  };

  // Timbrature
  const sh = foglio_();
  const dati = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, INTESTAZIONE.length).getValues() : [];
  dati.forEach(r => {
    const id = String(r[0] || '');
    const ent = r[4] instanceof Date ? r[4] : null;
    if (!id || !ent || ent.getTime() < limite) return;
    const dip = String(r[1]), cant = String(r[3]);
    const sede = String(r[COL_SEDE - 1] || '');
    if (sede.indexOf('FUORI SEDE') === 0) {
      aggiungi(id + '|f', 'Timbratura fuori sede', dip, cant + ' · entrata ' + f(ent) + ' · ' + sede);
    }
    if (sede.indexOf('PROVA') === 0) {
      aggiungi(id + '|p', 'Timbratura in modalità prova', dip, cant + ' · entrata ' + f(ent));
    }
    if (r[7] === 'In corso' && ora - ent.getTime() > ORE_USCITA_DIMENTICATA * 36e5) {
      aggiungi(id + '|u', 'Uscita non timbrata', dip, cant + ' · entrata ' + f(ent) + ' · nessuna uscita dopo ' + ORE_USCITA_DIMENTICATA + ' ore');
    }
    if (r[COL_STATO_EXTRA - 1] === EXTRA_ATTESA) {
      const extra = String(r[COL_EXTRA - 1]).replace('.', ',');
      const motivo = String(r[COL_MOTIVO - 1] || '') + (r[COL_NOTA - 1] ? ' – ' + r[COL_NOTA - 1] : '');
      const uscita = r[5] instanceof Date ? ' → ' + Utilities.formatDate(r[5], tz, 'HH:mm') : '';
      aggiungi(id + '|e' + r[COL_EXTRA - 1], 'Ore extra da autorizzare', dip,
        cant + ' · ' + f(ent) + uscita + ' · +' + extra + ' h · ' + (motivo || 'motivo non indicato'));
    }
  });

  // Ferie, permessi, malattia in attesa
  assenze_().filter(a => a.stato === ASS_ATTESA).forEach(a => {
    aggiungi(a.id + '|a', a.tipo + ' da approvare', a.dip,
      'dal ' + a.dal + (a.al && a.al !== a.dal ? ' al ' + a.al : '') + (a.ore ? ' · ' + a.ore + ' h' : '') + (a.nota ? ' · ' + a.nota : ''));
  });

  if (visti.length > 250) visti = visti.slice(-250);
  props.setProperty('AVVISI_INVIATI', JSON.stringify(visti));
  if (soloSegna === true || !nuovi.length) return;

  const oggetto = nuovi.length === 1
    ? 'GE3CO – ' + nuovi[0].titolo + ': ' + nuovi[0].dip
    : 'GE3CO – ' + nuovi.length + ' avvisi';
  const html = nuovi.map(x => '<p><b>' + x.titolo + '</b><br>' + x.dip + '<br>' + x.testo + '</p>').join('') +
    '<p>Si sistema dall\'app: tieni premuto il logo GE3CO → Area responsabile.</p>';
  MailApp.sendEmail({
    to: EMAIL_RESPONSABILE || Session.getEffectiveUser().getEmail(),
    subject: oggetto,
    htmlBody: html,
  });
}

// ---------- Programma della settimana (squadre per giorno e turno) ----------
// Il responsabile lo compila dall'app (Area responsabile → Programma); gli operatori vedono i loro turni.
// Scheda "Programma": una riga per squadra. Scheda "Operatori": elenco delle persone da scegliere.

const FOGLIO_PROGRAMMA = 'Programma';
const INTEST_PROGRAMMA = ['ID', 'Data', 'Turno', 'Cantiere', 'Operatori', 'Nota'];
const FOGLIO_OPERATORI = 'Operatori';

function foglioProgramma_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FOGLIO_PROGRAMMA);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_PROGRAMMA);
    sh.appendRow(INTEST_PROGRAMMA);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, INTEST_PROGRAMMA.length).setFontWeight('bold').setBackground('#e7f2ea');
    sh.hideColumns(1);
    sh.getRange('B:B').setNumberFormat('ddd dd/mm/yyyy');
    sh.setColumnWidth(5, 320);
  }
  return sh;
}

function foglioOperatori_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FOGLIO_OPERATORI);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_OPERATORI);
    sh.getRange(1, 1, 1, 3).setValues([['Operatore', 'Attivo', 'Ore settimanali']]).setFontWeight('bold').setBackground('#e7f2ea');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 240);
    const nomi = nomiDaTimbrature_();
    if (nomi.length) sh.getRange(2, 1, nomi.length, 3).setValues(nomi.map(n => [n, 'SI', 30]));
  }
  if (sh.getRange(1, 3).getValue() !== 'Ore settimanali') {
    sh.getRange(1, 3).setValue('Ore settimanali').setFontWeight('bold').setBackground('#e7f2ea');
  }
  return sh;
}

function nomiDaTimbrature_() {
  const sh = foglio_();
  if (sh.getLastRow() < 2) return [];
  const visti = {};
  sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(r => {
    const n = String(r[0] || '').trim();
    if (n && n !== 'Sconosciuto' && n !== 'Prova Dipendente') visti[n] = true;
  });
  return Object.keys(visti).sort();
}

/** Operatori da scegliere: quelli della scheda "Operatori" più chi ha già timbrato. */
function operatori_() {
  const sh = foglioOperatori_();
  const elenco = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => String(r[0]).trim())
    .map(r => ({ nome: String(r[0]).trim(), attivo: String(r[1]).trim().toUpperCase() !== 'NO', ore: Number(r[2]) || 30 })) : [];
  const noti = {};
  elenco.forEach(o => { noti[o.nome.toLowerCase()] = true; });
  nomiDaTimbrature_().forEach(n => { if (!noti[n.toLowerCase()]) elenco.push({ nome: n, attivo: true, ore: 30 }); });
  return elenco.sort((a, b) => a.nome.localeCompare(b.nome));
}

function salvaOperatori_(lista) {
  if (!Array.isArray(lista)) return;
  const visti = {};
  const righe = [];
  lista.forEach(o => {
    const nome = String(o && o.nome || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!nome || visti[nome.toLowerCase()]) return;
    visti[nome.toLowerCase()] = true;
    righe.push([nome, o.attivo === false ? 'NO' : 'SI', Math.max(1, Math.min(60, Number(o.ore) || 30))]);
  });
  const sh = foglioOperatori_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  if (righe.length) sh.getRange(2, 1, righe.length, 3).setValues(righe);
}

function dataIso_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function daIso_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Squadre tra due date comprese (stringhe AAAA-MM-GG). */
function programma_(da, a) {
  const sh = foglioProgramma_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, INTEST_PROGRAMMA.length).getValues()
    .filter(r => r[1] instanceof Date)
    .map(r => ({ id: String(r[0]), data: dataIso_(r[1]), turno: String(r[2]), cantiere: String(r[3]),
      operatori: String(r[4] || '').split(',').map(x => x.trim()).filter(Boolean), nota: String(r[5] || '') }))
    .filter(s => (!da || s.data >= da) && (!a || s.data <= a))
    .sort((x, y) => (x.data + x.turno).localeCompare(y.data + y.turno));
}

/** Sostituisce tutte le squadre tra due date con quelle nuove. */
function salvaProgramma_(da, a, squadre) {
  if (!daIso_(da) || !daIso_(a) || !Array.isArray(squadre)) return;
  const sh = foglioProgramma_();
  const tutte = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, INTEST_PROGRAMMA.length).getValues() : [];
  const resto = tutte.filter(r => !(r[1] instanceof Date) || dataIso_(r[1]) < da || dataIso_(r[1]) > a);
  const nuove = squadre.map(s => {
    const d = daIso_(s.data);
    if (!d || s.data < da || s.data > a) return null;
    const ops = (Array.isArray(s.operatori) ? s.operatori : []).map(x => String(x).trim()).filter(Boolean);
    if (!ops.length) return null;
    return [String(s.id || Utilities.getUuid()).slice(0, 40), d, String(s.turno || '').slice(0, 20),
      String(s.cantiere || '').trim().toUpperCase().slice(0, 60), ops.join(', '), String(s.nota || '').slice(0, 200)];
  }).filter(Boolean);
  const righe = resto.concat(nuove).sort((x, y) => (x[1] - y[1]) || String(x[2]).localeCompare(String(y[2])));
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, INTEST_PROGRAMMA.length).clearContent();
  if (righe.length) sh.getRange(2, 1, righe.length, INTEST_PROGRAMMA.length).setValues(righe);
}

/** Per gli operatori (senza password): le squadre dei prossimi giorni. */
function programmaPubblico_(e) {
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const fra = new Date(oggi.getTime() + 13 * 864e5);
  const da = daIso_(e.parameter.da) ? e.parameter.da : dataIso_(oggi);
  const a = daIso_(e.parameter.a) ? e.parameter.a : dataIso_(fra);
  return { ok: true, squadre: programma_(da, a) };
}

// ---------- Interventi (segnalazioni da ritirare) ----------
// Il responsabile crea l'intervento dall'app (dati del cliente, cosa ritirare, screenshot dell'email) e lo assegna.
// L'operatore lo vede, naviga, fa le foto prima e dopo e lo chiude. Le foto vanno in una cartella di Google Drive.

const FOGLIO_INTERVENTI = 'Interventi';
const INTEST_INTERVENTI = ['ID', 'Creato', 'Data', 'Cliente', 'Indirizzo', 'Località', 'Coordinate', 'Cosa ritirare', 'Note',
  'Assegnato a', 'Stato', 'Fatto il', 'Fatto da', 'Nota operatore', 'Screenshot', 'Foto prima', 'Foto dopo', 'Posizione chiusura'];
const INT_DA_FARE = 'Da fare', INT_FATTO = 'Fatto';
const INT_TUTTI = 'Tutti';

function foglioInterventi_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FOGLIO_INTERVENTI);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_INTERVENTI);
    sh.appendRow(INTEST_INTERVENTI);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, INTEST_INTERVENTI.length).setFontWeight('bold').setBackground('#e7f2ea');
    sh.hideColumns(1);
    sh.getRange('B:B').setNumberFormat('dd/mm/yyyy HH:mm');
    sh.getRange('C:C').setNumberFormat('dd/mm/yyyy');
    sh.getRange('L:L').setNumberFormat('dd/mm/yyyy HH:mm');
  }
  return sh;
}

/** Cartella Drive "GE3CO Interventi" (creata la prima volta). */
function cartellaInterventi_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARTELLA_INTERVENTI');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* cancellata: se ne crea un'altra */ } }
  const f = DriveApp.createFolder('GE3CO Interventi');
  props.setProperty('CARTELLA_INTERVENTI', f.getId());
  return f;
}

function salvaFoto_(base64, nome) {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(base64 || ''));
  if (!m) return '';
  const blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], nome + (m[2] === 'png' ? '.png' : '.jpg'));
  return cartellaInterventi_().createFile(blob).getId();
}

function intRiga_(r) {
  return { id: String(r[0]), creato: r[1] instanceof Date ? r[1].getTime() : null,
    data: r[2] instanceof Date ? dataIso_(r[2]) : '', cliente: String(r[3] || ''), indirizzo: String(r[4] || ''),
    localita: String(r[5] || ''), coord: String(r[6] || ''), cosa: String(r[7] || ''), note: String(r[8] || ''),
    assegnato: String(r[9] || INT_TUTTI), stato: String(r[10] || INT_DA_FARE),
    fattoIl: r[11] instanceof Date ? r[11].getTime() : null, fattoDa: String(r[12] || ''), notaOp: String(r[13] || ''),
    screenshot: !!r[14], fotoPrima: !!r[15], fotoDopo: !!r[16], posChiusura: String(r[17] || '') };
}

function interventi_() {
  const sh = foglioInterventi_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, INTEST_INTERVENTI.length).getValues()
    .filter(r => r[0]).map(intRiga_)
    .sort((a, b) => (a.stato === b.stato ? 0 : a.stato === INT_DA_FARE ? -1 : 1) || (a.data || '').localeCompare(b.data || '') || (a.creato - b.creato));
}

/** Nuovo intervento o modifica (dal responsabile). */
function salvaIntervento_(x) {
  if (!x || !String(x.indirizzo || '').trim()) return;
  const sh = foglioInterventi_();
  const id = String(x.id || Utilities.getUuid()).slice(0, 40);
  let r = trovaRiga_(sh, id);
  const prima = r ? sh.getRange(r, 1, 1, INTEST_INTERVENTI.length).getValues()[0] : null;
  const giorno = daIso_(x.data) || new Date(new Date().setHours(0, 0, 0, 0));
  const shot = x.screenshot ? salvaFoto_(x.screenshot, 'segnalazione ' + dataIso_(giorno) + ' ' + String(x.indirizzo).slice(0, 40)) : (prima ? prima[14] : '');
  const row = [id, prima ? prima[1] : new Date(), giorno, String(x.cliente || '').slice(0, 80), String(x.indirizzo).trim().slice(0, 120),
    String(x.localita || '').trim().slice(0, 60), String(x.coord || '').trim().slice(0, 60), String(x.cosa || '').slice(0, 500),
    String(x.note || '').slice(0, 300), String(x.assegnato || INT_TUTTI).slice(0, 80),
    prima ? prima[10] : INT_DA_FARE, prima ? prima[11] : '', prima ? prima[12] : '', prima ? prima[13] : '',
    shot, prima ? prima[15] : '', prima ? prima[16] : '', prima ? prima[17] : ''];
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  return id;
}

function riapriIntervento_(id) {
  const sh = foglioInterventi_();
  const r = trovaRiga_(sh, id);
  if (r) sh.getRange(r, 11, 1, 3).setValues([[INT_DA_FARE, '', '']]);
}

function eliminaIntervento_(id) {
  const sh = foglioInterventi_();
  const r = trovaRiga_(sh, id);
  if (!r) return;
  const v = sh.getRange(r, 15, 1, 3).getValues()[0];
  v.filter(Boolean).forEach(fid => { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { /* già tolta */ } });
  sh.deleteRow(r);
}

/** Chiusura dall'operatore (arriva in coda con le timbrature): foto prima/dopo, nota, posizione. */
function chiudiIntervento_(x, user) {
  if (!x || !x.id) return;
  const sh = foglioInterventi_();
  const r = trovaRiga_(sh, x.id);
  if (!r) return;
  const riga = sh.getRange(r, 1, 1, INTEST_INTERVENTI.length).getValues()[0];
  const base = dataIso_(new Date()) + ' ' + String(riga[4]).slice(0, 40);
  const prima = x.fotoPrima ? salvaFoto_(x.fotoPrima, base + ' prima') : riga[15];
  const dopo = x.fotoDopo ? salvaFoto_(x.fotoDopo, base + ' dopo') : riga[16];
  sh.getRange(r, 11, 1, 8).setValues([[INT_FATTO, x.at ? new Date(x.at) : new Date(), user && user.name || 'Sconosciuto',
    String(x.nota || '').slice(0, 300), riga[14], prima, dopo, mappa_(x.pos) || '']]);
}

/** Foto di un intervento come base64 (così non serve condividere i file di Drive). */
function fotoIntervento_(id, tipo) {
  const sh = foglioInterventi_();
  const r = trovaRiga_(sh, id);
  if (!r) return null;
  const col = { screenshot: 15, prima: 16, dopo: 17 }[tipo];
  const fid = col && sh.getRange(r, col).getValue();
  if (!fid) return null;
  const blob = DriveApp.getFileById(fid).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/** Per gli operatori: interventi assegnati a loro o a tutti, da fare o chiusi negli ultimi 2 giorni. */
function interventiPubblico_(e) {
  const nome = String(e.parameter.nome || '').trim().toLowerCase();
  const limite = Date.now() - 2 * 864e5;
  const lista = interventi_().filter(x => (x.assegnato === INT_TUTTI || x.assegnato.toLowerCase() === nome) &&
    (x.stato === INT_DA_FARE || (x.fattoIl && x.fattoIl > limite)));
  return { ok: true, interventi: lista };
}
