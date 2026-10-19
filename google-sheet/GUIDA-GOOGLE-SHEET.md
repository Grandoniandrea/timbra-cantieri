# Registro aziendale su Google Sheet

Ogni timbratura dei dipendenti arriva in automatico in un Google Sheet del responsabile.
Il 1° di ogni mese il responsabile riceve per email il riepilogo ore di tutto il personale, con l'Excel allegato.

Si fa **una volta sola**, in circa 10 minuti, dal computer.

## 1. Crea il foglio
1. Vai su [sheets.new](https://sheets.new) con l'account Google del responsabile.
2. Chiamalo **GE3CO – Timbrature**.
3. **File → Impostazioni → Fuso orario:** *(GMT+01:00) Roma*. Salva.

## 2. Incolla lo script
1. Nel foglio: **Estensioni → Apps Script**.
2. Cancella tutto quello che c'è e incolla il contenuto di [`Codice.gs`](Codice.gs).
3. Alla riga `EMAIL_RESPONSABILE` scrivi l'email di chi deve ricevere il riepilogo.
4. Icona ⚙️ **Impostazioni progetto → Fuso orario:** *Europe/Rome*.
5. Salva (icona del dischetto).

## 3. Pubblica come app web
1. In alto a destra: **Esegui il deployment → Nuovo deployment**.
2. Icona ⚙️ accanto a "Seleziona tipo" → **App web**.
3. **Esegui come:** *Me*. **Chi ha accesso:** *Chiunque*.
4. **Esegui il deployment** → **Autorizza accesso** → scegli il tuo account →
   *Avanzate → Vai a … (non sicuro)* → **Consenti**.
   (Google lo chiama "non sicuro" solo perché lo script l'hai creato tu e non è verificato da Google.)
5. Copia l'**URL dell'app web**: finisce con `/exec`.

## 4. Crea il link per i dipendenti
Il link da mandare (WhatsApp o email) è:

```
https://grandoniandrea.github.io/timbra-cantieri/?collega=URL_APP_WEB
```

sostituendo `URL_APP_WEB` con l'URL copiato al punto 3.
Il dipendente lo apre **una volta** sul suo telefono, mette nome e cognome e tocca **Collega**.
Da quel momento ogni entrata e uscita arriva nel foglio. Senza rete le timbrature restano in coda e partono appena torna il segnale.

## 5. Attiva il riepilogo automatico
1. Ricarica il Google Sheet: compare il menu **Timbra Cantieri**.
2. **Timbra Cantieri → Attiva invio automatico il 1° del mese** (la prima volta chiede di nuovo l'autorizzazione).

Dallo stesso menu puoi:
- creare il riepilogo del mese in corso o del mese scorso (foglio "Riepilogo AAAA-MM");
- inviare subito l'email del mese scorso, per provare.

## Cosa c'è nel foglio
- **Timbrature:** una riga per turno con dipendente, data, cantiere, entrata, uscita, ore e stato (*In corso* / *Chiuso*).
- **Riepilogo AAAA-MM:** per ogni dipendente giorni lavorati, ore totali, ore per cantiere e turni senza uscita.

## Se modifichi lo script
Dopo una modifica: **Esegui il deployment → Gestisci deployment → ✏️ → Versione: Nuova versione → Esegui il deployment**.
Così l'URL resta lo stesso e i dipendenti non devono ricollegarsi.
