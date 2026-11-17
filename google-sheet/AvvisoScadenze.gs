/**
 * Timbra Cantieri – Avviso via email delle scadenze (visite mediche, corsi, patenti, contratti).
 *
 * Quando una voce arriva a SOGLIA_GIORNI dalla scadenza (o è già scaduta) parte una email
 * ogni OGNI_GIORNI giorni, finché la voce non viene rinnovata o segnata come prenotata.
 *
 * Installazione (una volta, dal computer):
 *  1. Nel progetto Apps Script: "+" accanto a File → Script → nome "AvvisoScadenze" → incolla questo file.
 *     Codice.gs resta com'è: non serve toccarlo.
 *  2. Scrivi qui sotto l'email del destinatario (più indirizzi separati da virgola).
 *  3. Scegli in alto la funzione "attivaAvvisoScadenze" e premi Esegui (la prima volta Google chiede l'autorizzazione).
 *     Parte subito una prima email di prova; poi arriva da sola alle 7 del mattino.
 * Attenzione: la funzione "configura" cancella tutti gli invii automatici. Se la riesegui, riesegui anche "attivaAvvisoScadenze".
 * Per fermare gli avvisi: esegui "disattivaAvvisoScadenze".
 */

// Chi riceve l'avviso (es. il Presidente). Più indirizzi separati da virgola.
const EMAIL_SCADENZE = 'INSERISCI_EMAIL';
// Da quanti giorni prima della scadenza parte l'avviso.
const SOGLIA_GIORNI = 20;
// Ogni quanti giorni si ripete l'email finché resta qualcosa da sistemare.
const OGNI_GIORNI = 2;
// Ora dell'invio (0-23).
const ORA_AVVISO_SCADENZE = 7;

function attivaAvvisoScadenze() {
  if (!EMAIL_SCADENZE || EMAIL_SCADENZE.indexOf('INSERISCI') === 0) throw new Error('Scrivi prima l\'email in EMAIL_SCADENZE, in cima al file AvvisoScadenze.');
  disattivaAvvisoScadenze();
  ScriptApp.newTrigger('avvisoScadenze').timeBased().everyDays(1).atHour(ORA_AVVISO_SCADENZE).create();
  PropertiesService.getScriptProperties().deleteProperty('AVVISO_SCADENZE_ULTIMO');
  const n = avvisoScadenze(true);
  Logger.log('Avviso scadenze attivo: ogni ' + OGNI_GIORNI + ' giorni alle ' + ORA_AVVISO_SCADENZE + ' a ' + EMAIL_SCADENZE + '. Email di prova inviata con ' + n + ' voci.');
}

function disattivaAvvisoScadenze() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'avvisoScadenze').forEach(t => ScriptApp.deleteTrigger(t));
}

/** Controllo giornaliero: invia solo se ci sono voci entro la soglia e sono passati OGNI_GIORNI dall'ultimo invio. */
function avvisoScadenze(forza) {
  if (!EMAIL_SCADENZE || EMAIL_SCADENZE.indexOf('INSERISCI') === 0) return 0;
  const props = PropertiesService.getScriptProperties();
  const tz = Session.getScriptTimeZone();
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const oggiIso = Utilities.formatDate(oggi, tz, 'yyyy-MM-dd');
  const ultimo = props.getProperty('AVVISO_SCADENZE_ULTIMO');
  if (forza !== true && ultimo) {
    const giorni = Math.round((oggi - daIso_(ultimo)) / 864e5);
    if (giorni < OGNI_GIORNI) return 0;
  }

  const d = scadenze_();
  const spenti = {};
  d.operatori.filter(o => o.attivo === false).forEach(o => { spenti[o.nome.toLowerCase()] = true; });
  const attive = {};
  d.voci.filter(v => v.attiva).forEach(v => { attive[v.nome.toLowerCase()] = true; });
  // Ultima registrazione per dipendente e voce
  const ultime = {};
  d.righe.forEach(r => { const k = r.operatore.toLowerCase() + '|' + r.voce.toLowerCase(); if (!ultime[k] || ultime[k].fatto < r.fatto) ultime[k] = r; });
  const giorniA = iso => Math.round((daIso_(iso) - oggi) / 864e5);
  const prenotato = note => { const m = /prenotat[oa]\s+(?:per\s+)?(?:il\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(note || ''); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; };

  const scaduti = [], vicini = [], prenotati = [];
  Object.keys(ultime).map(k => ultime[k]).forEach(r => {
    if (!r.scadenza || spenti[r.operatore.toLowerCase()] || !attive[r.voce.toLowerCase()]) return;
    const g = giorniA(r.scadenza);
    if (g > SOGLIA_GIORNI) return;
    const p = prenotato(r.note);
    const x = { chi: r.operatore, cosa: r.voce, scadenza: r.scadenza, g: g, pren: p };
    if (p && giorniA(p) >= 0) prenotati.push(x); else if (g < 0) scaduti.push(x); else vicini.push(x);
  });
  // Contratti a tempo determinato
  d.operatori.filter(o => o.attivo !== false && o.scadenzaContratto).forEach(o => {
    const g = giorniA(o.scadenzaContratto);
    if (g > SOGLIA_GIORNI) return;
    (g < 0 ? scaduti : vicini).push({ chi: o.nome, cosa: 'Contratto a tempo determinato', scadenza: o.scadenzaContratto, g: g, pren: '' });
  });

  if (!scaduti.length && !vicini.length) return 0; // niente da sistemare: nessuna email
  const ord = (a, b) => a.scadenza.localeCompare(b.scadenza) || a.chi.localeCompare(b.chi);
  scaduti.sort(ord); vicini.sort(ord); prenotati.sort(ord);
  const dmy = iso => iso.split('-').reverse().join('/');
  const riga = (x, testo, colore) => '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>' + x.chi + '</b></td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + x.cosa + '</td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + dmy(x.scadenza) + '</td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee;color:' + colore + ';font-weight:bold">' + testo + '</td></tr>';
  const tabella = (titolo, lista, fn, colore) => !lista.length ? '' :
    '<h3 style="margin:18px 0 6px;color:' + colore + '">' + titolo + ' (' + lista.length + ')</h3>' +
    '<table style="border-collapse:collapse;font:14px Arial,sans-serif;width:100%"><tr style="background:#f3f4ef">' +
    '<th style="text-align:left;padding:6px 10px">Dipendente</th><th style="text-align:left;padding:6px 10px">Visita o corso</th>' +
    '<th style="text-align:left;padding:6px 10px">Scadenza</th><th style="text-align:left;padding:6px 10px">Stato</th></tr>' +
    lista.map(x => riga(x, fn(x), colore)).join('') + '</table>';

  const html = '<div style="font:14px Arial,sans-serif;color:#222">' +
    '<p>Visite mediche, corsi e contratti da sistemare (scaduti o entro ' + SOGLIA_GIORNI + ' giorni):</p>' +
    tabella('Scaduti', scaduti, x => 'SCADUTO da ' + (-x.g) + ' g', '#b42318') +
    tabella('In scadenza', vicini, x => x.g === 0 ? 'scade oggi' : 'tra ' + x.g + ' g', '#9a4a05') +
    tabella('Già prenotati', prenotati, x => 'prenotato il ' + dmy(x.pren), '#1a4fa0') +
    '<p style="margin-top:16px;color:#555">L\'email si ripete ogni ' + OGNI_GIORNI + ' giorni finché la voce non viene rinnovata o segnata come prenotata ' +
    '(Area responsabile → Dipendenti → nome → Rinnova / Prenota).</p></div>';
  const oggetto = 'GEECO – Scadenze: ' + (scaduti.length ? scaduti.length + ' scadut' + (scaduti.length === 1 ? 'o' : 'i') : '') +
    (scaduti.length && vicini.length ? ', ' : '') + (vicini.length ? vicini.length + ' in scadenza' : '');
  MailApp.sendEmail({ to: EMAIL_SCADENZE, subject: oggetto, htmlBody: html });
  props.setProperty('AVVISO_SCADENZE_ULTIMO', oggiIso);
  return scaduti.length + vicini.length;
}
