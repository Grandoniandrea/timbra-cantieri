# Registro aziendale su Google Sheet

Ogni timbratura dei dipendenti arriva in automatico in un Google Sheet del responsabile.
Il 1° di ogni mese il responsabile riceve per email il riepilogo ore di tutto il personale, con l'Excel allegato.

Si fa **una volta sola**, dal computer.

## 1. Crea il foglio
1. Vai su [sheets.new](https://sheets.new) e chiamalo **GE3CO – Timbrature**.
2. Copia l'ID del foglio dall'indirizzo: è la parte tra `/d/` e `/edit`.

## 2. Crea lo script
1. Vai su [script.google.com/create](https://script.google.com/create).
2. Cancella tutto e incolla il contenuto di [`Codice.gs`](Codice.gs).
3. In `ID_FOGLIO` metti l'ID copiato.
   `EMAIL_RESPONSABILE` vuoto vuol dire che il riepilogo va all'email del tuo account Google.
4. Salva.
5. Scegli la funzione **configura**, poi **▷ Esegui** e autorizza
   (*Avanzate → Vai a … (non sicuro) → Consenti*: Google la chiama "non sicura" solo perché non è verificata da loro).
   Così crea il foglio "Timbrature" e l'invio automatico il 1° del mese alle 7.

## 3. Pubblica come app web
**Esegui il deployment → Nuovo deployment →** tipo **Applicazione web**.
Esegui come: *Me*. Utenti autorizzati: *Chiunque*. Poi copia l'URL che finisce con `/exec`.

## 4. Link per i dipendenti
```
https://grandoniandrea.github.io/timbra-cantieri/?collega=URL_APP_WEB
```
Il dipendente lo apre **una volta** sul suo telefono, mette nome e cognome e tocca **Collega**.
Senza rete le timbrature restano in coda e partono appena torna il segnale.
Non pubblicare questo link: chi lo ha può inviare timbrature al foglio.

## Riepilogo a mano
Nell'editor dello script scegli la funzione ed eseguila:
- `riepilogoMeseCorrente` / `riepilogoMeseScorso` creano il foglio "Riepilogo AAAA-MM";
- `inviaRiepilogoMeseScorso` manda subito l'email.

## Se modifichi lo script
Salva. Se hai toccato la parte che riceve le timbrature (`doPost`):
**Esegui il deployment → Gestisci deployment → ✏️ → Versione: Nuova versione → Esegui il deployment**.
L'URL resta lo stesso.

## Aggiornamento: avvisi immediati e programma della settimana
Il file `Codice.gs` qui contiene due parti nuove: **avvisi immediati** al responsabile
(fuori sede, modalità prova, extra e ferie da approvare, uscita dimenticata dopo 6 ore)
e il **programma della settimana** (squadre per giorno e turno, compilato dall'app).

Per installarle nello script già in uso, senza perdere ID del foglio, nome e telefono del responsabile:
1. Nell'editor dello script copia da qui **in fondo al file** le sezioni
   "Avvisi immediati al responsabile" e "Programma della settimana".
2. In `doPost`, dopo il blocco `ops.forEach(...)`, aggiungi
   `try { avvisiImmediati(); } catch (err) {}`.
3. In `doGet`, come prima riga: `if (e && e.parameter && e.parameter.azione === 'programma') return json_(programmaPubblico_(e));`
4. In `admin_`, nello `switch`, aggiungi i tre `case` `'programma'`, `'salvaprogramma'` e `'operatori'` (copiali da qui).
5. Salva, poi **Gestisci deployment → ✏️ → Nuova versione → Esegui il deployment**.
6. Esegui una volta **attivaAvvisiImmediati**.
