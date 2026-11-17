'use strict';
// GEECO · Importa visite mediche e corsi dagli Excel aziendali.
// Riconosce due file:
//  - "Formazione": una riga per dipendente, una colonna per corso, nelle celle la data di scadenza.
//    Le celle grigie ("scaduto ma da non rinnovare") non si importano.
//  - "Tabellone scadenze visite mediche": una riga per dipendente con "Data scadenza" e "Data_scadenza".
// Si importano solo nomi e date: niente esiti, mansioni o giudizi di idoneità.
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addMonths = (iso, n) => { const d = dayOf(iso); d.setMonth(d.getMonth() + n); return isoOf(d); };
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cap = s => String(s).toLowerCase().replace(/(^|[\s'’-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase());

  // Data da cella: Date (cellDates), numero seriale Excel o testo gg/mm/aaaa
  function toIso(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return isoOf(new Date(v.getTime() + 12 * 36e5)); // mezzogiorno: niente scivoloni di fuso
    if (typeof v === 'number' && v > 20000 && v < 80000) return isoOf(new Date(Math.round((v - 25569) * 864e5) + 12 * 36e5));
    const m = String(v).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (m) { const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad(m[2])}-${pad(m[1])}`; }
    return '';
  }
  // Grigio dei temi Excel (bianco scurito): nella legenda è "scaduto ma da non rinnovare"
  const isGrey = s => !!(s && s.patternType === 'solid' && s.fgColor && s.fgColor.theme === 0 && Number(s.fgColor.tint) < -0.1);
  const isName = s => { const t = String(s || '').trim(); return t.length > 2 && /[a-zA-Z]/.test(t) && !/\d|°|partecip|tipologia|dipendente|scadut|scadenza/i.test(t); };

  // Corsi del file Formazione → voce dell'app. "trova" riconosce una voce già presente con un altro nome.
  const CORSI = [
    { col: /^rls$/, nome: 'RLS', cat: 'Formazione', mesi: 12, trova: /^rls\b/ },
    { col: /prepost/, nome: 'Preposto', cat: 'Formazione', mesi: 24, trova: /prepost/ },
    { col: /primo soccorso/, nome: 'Primo soccorso', cat: 'Formazione', mesi: 36, trova: /primo soccorso/ },
    { col: /emergenz/, nome: 'Antincendio', cat: 'Formazione', mesi: 60, trova: /antincendio|emergenz/ },
    { col: /amianto/, nome: 'Amianto (L. 257/92)', cat: 'Formazione', mesi: 24, trova: /amianto/ },
    { col: /cantieri stradal/, nome: 'Segnaletica e lavori su strada', cat: 'Formazione', mesi: 48, trova: /strad|segnaletic/ },
    { col: /carrellist/, nome: 'Carrello elevatore', cat: 'Abilitazioni', mesi: 60, trova: /carrell/ },
    { col: /escavator/, nome: 'Escavatore', cat: 'Abilitazioni', mesi: 60, trova: /escavator/ },
    { col: /dirigent/, nome: 'Formazione dirigente', cat: 'Formazione', mesi: 60, trova: /dirigent/ },
    { col: /^gru$/, nome: 'Gru su autocarro (ragno)', cat: 'Abilitazioni', mesi: 60, trova: /\bgru\b/ },
    { col: /^lavorator/, nome: 'Corso sicurezza lavoratori (generale + specifica, rischio alto)', cat: 'Formazione', mesi: 60, trova: /lavorator/ },
    { col: /pala caricatric/, nome: 'Pala caricatrice', cat: 'Abilitazioni', mesi: 60, trova: /pala/ },
    { col: /^ple$/, nome: 'Piattaforme di lavoro elevabili (PLE)', cat: 'Abilitazioni', mesi: 60, trova: /\bple\b|piattaform/ },
    { col: /ponteggi/, nome: 'Ponteggi', cat: 'Abilitazioni', mesi: 48, trova: /ponteggi/ },
    { col: /sollevatore telescop/, nome: 'Sollevatore telescopico', cat: 'Abilitazioni', mesi: 60, trova: /telescop/ },
    { col: /spazi confinat/, nome: 'Spazi confinati', cat: 'Formazione', mesi: 60, trova: /confinat/ },
    { col: /trattor/, nome: 'Trattore agricolo', cat: 'Abilitazioni', mesi: 60, trova: /trattor/ }
  ];
  const VISITA = { nome: 'Visita medica periodica', cat: 'Sorveglianza sanitaria', mesi: 12, trova: /visita medica/ };

  const grid = (ws, XLSX) => {
    const rg = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const rows = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const row = [];
      for (let c = rg.s.c; c <= rg.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; row.push(cell || null); }
      rows.push(row);
    }
    return rows;
  };
  const val = cell => cell ? (cell.v !== undefined ? cell.v : cell.w) : null;

  // Legge un file già aperto con SheetJS ({ cellDates: true, cellStyles: true }).
  // Torna { tipo, voci: [modelli], righe: [{ nome, modello, scadenza, fatto?, nota? }], saltate: [testo] }
  function leggi(wb, XLSX, oggiIso) {
    const oggi = oggiIso || isoOf(new Date());
    for (const sn of wb.SheetNames) {
      const rows = grid(wb.Sheets[sn], XLSX);
      // Formazione: una riga con "Tipologia Formazione" e i nomi dei corsi
      const hi = rows.findIndex(r => /tipologia formazione/i.test(String(val(r[0]) || '')));
      if (hi >= 0) {
        const head = rows[hi].map(c => norm(val(c)));
        const cols = head.map(h => h && CORSI.find(k => k.col.test(h)) || null);
        const out = { tipo: 'formazione', foglio: sn, righe: [], saltate: [], ignote: head.filter((h, i) => i > 0 && h && !cols[i]) };
        rows.slice(hi + 1).forEach(r => {
          const nome = String(val(r[0]) || '').trim();
          if (!isName(nome)) return;
          r.forEach((cell, i) => {
            if (!i || !cols[i] || !cell) return;
            const sc = toIso(val(cell));
            if (!sc) return;
            if (isGrey(cell.s)) { out.saltate.push(`${cap(nome)} · ${cols[i].nome}: scaduto ma da non rinnovare`); return; }
            out.righe.push({ nome: cap(nome), modello: cols[i], scadenza: sc });
          });
        });
        return out;
      }
      // Visite mediche: intestazione con "Nominativo" e le due date
      const vi = rows.findIndex(r => r.some(c => /^nominativo$/i.test(String(val(c) || '').trim())));
      if (vi >= 0) {
        const head = rows[vi].map(c => String(val(c) || '').trim());
        const cN = head.findIndex(h => /^nominativo$/i.test(h));
        const cS = head.findIndex(h => /^data scadenza$/i.test(h));     // prossima scadenza
        const cU = head.findIndex(h => /^data_scadenza$/i.test(h));     // nel tabellone è la data dell'ultima visita
        const cA = head.findIndex(h => /^macro_attivit/i.test(h));
        const out = { tipo: 'visite', foglio: sn, righe: [], saltate: [], ignote: [] };
        rows.slice(vi + 1).forEach(r => {
          const nome = String(val(r[cN]) || '').trim().replace(/\s+/g, ' ');
          if (!isName(nome)) return;
          if (cA >= 0 && val(r[cA]) && !/visita/i.test(String(val(r[cA])))) return;
          const s = cS >= 0 ? toIso(val(r[cS])) : '', u = cU >= 0 ? toIso(val(r[cU])) : '';
          const n = cap(nome);
          if (!s && !u) { out.saltate.push(`${n}: nessuna data`); return; }
          let x;
          if (!s) x = { scadenza: u };                                              // c'è solo una data: è la scadenza
          else if (!u || u < s) x = { scadenza: s, fatto: u || '' };                 // caso normale
          else if (u > oggi) x = { scadenza: s, nota: `Data successiva nel tabellone: ${u.split('-').reverse().join('/')}` }; // probabile prenotazione
          else x = { scadenza: addMonths(u, VISITA.mesi), fatto: u, nota: 'Visita rifatta dopo la scadenza: scadenza calcolata a 12 mesi, da verificare' };
          out.righe.push(Object.assign({ nome: n, modello: VISITA }, x));
        });
        return out;
      }
    }
    return { tipo: '', righe: [], saltate: [], ignote: [] };
  }

  // Abbina un nome dell'Excel ("Cognome Nome") a un operatore dell'app ("Grandoni", "Mario Rossi"…)
  function abbina(nomiExcel, operatori) {
    const ops = (operatori || []).map(o => o.nome);
    const map = {};
    const cognomi = {};
    nomiExcel.forEach(n => { const k = norm(n).split(' ')[0]; cognomi[k] = (cognomi[k] || 0) + 1; });
    nomiExcel.forEach(n => {
      const nn = norm(n), parti = nn.split(' ');
      const giro = parti.slice(1).concat(parti[0]).join(' ');
      let o = ops.find(x => norm(x) === nn || norm(x) === giro);
      if (!o && cognomi[parti[0]] === 1) {
        const c = ops.filter(x => norm(x) === parti[0] || norm(x).split(' ').includes(parti[0]) && norm(x).split(' ').every(t => parti.includes(t)));
        if (c.length === 1) o = c[0];
      }
      map[n] = o || n;
    });
    return map;
  }

  // Prepara l'importazione rispetto ai dati del registro: voci da aggiungere, righe nuove, doppioni saltati.
  function prepara(letti, sc) {
    const voci = (sc.voci || []).slice();
    const nuoveVoci = [];
    const voceDi = mod => {
      let v = voci.find(x => norm(x.nome) === norm(mod.nome)) || voci.find(x => mod.trova.test(norm(x.nome)));
      if (!v) { v = { nome: mod.nome, cat: mod.cat, mesi: mod.mesi, attiva: true }; voci.push(v); nuoveVoci.push(v); }
      return v;
    };
    const tutte = [].concat(...letti.map(l => l.righe));
    const nomi = [...new Set(tutte.map(r => r.nome))];
    const chi = abbina(nomi, sc.operatori);
    const gia = new Set((sc.righe || []).map(r => norm(r.operatore) + '|' + norm(r.voce) + '|' + r.scadenza));
    const righe = [], doppioni = [];
    tutte.forEach(r => {
      const v = voceDi(r.modello);
      const operatore = chi[r.nome];
      const mesi = Number(v.mesi) || r.modello.mesi;
      const stimata = !r.fatto;
      const fatto = r.fatto || addMonths(r.scadenza, -mesi);
      const note = [stimata ? `Da Excel aziendale: data ${r.modello === VISITA ? 'della visita' : 'del corso'} stimata dalla scadenza` : 'Da Excel aziendale', r.nota].filter(Boolean).join(' · ');
      const k = norm(operatore) + '|' + norm(v.nome) + '|' + r.scadenza;
      if (gia.has(k)) { doppioni.push(k); return; }
      gia.add(k);
      righe.push({ operatore, voce: v.nome, cat: v.cat, fatto, scadenza: r.scadenza, note });
    });
    const abbinati = nomi.filter(n => chi[n] !== n).map(n => [n, chi[n]]);
    return { righe, nuoveVoci, doppioni: doppioni.length, persone: [...new Set(righe.map(r => r.operatore))].length, abbinati,
      saltate: [].concat(...letti.map(l => l.saltate)), ignote: [].concat(...letti.map(l => l.ignote)) };
  }

  const api = { leggi, prepara, abbina, toIso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ImportScad = api;
})(typeof self !== 'undefined' ? self : this);
