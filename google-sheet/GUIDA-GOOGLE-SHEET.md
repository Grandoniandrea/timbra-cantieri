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

## Aggiornamento: avvisi immediati, programma della settimana, interventi
Il file `Codice.gs` qui contiene tre parti nuove: **avvisi immediati** al responsabile
(fuori sede, modalità prova, extra e ferie da approvare, uscita dimenticata dopo 6 ore),
il **programma della settimana** (squadre per giorno e turno, compilato dall'app)
e gli **interventi** (segnalazioni con foto prima/dopo salvate nella cartella Drive "GE3CO Interventi").

Per installarle nello script già in uso, senza perdere ID del foglio, nome e telefono del responsabile:
1. Nell'editor dello script copia da qui **in fondo al file** le sezioni
   "Avvisi immediati al responsabile", "Programma della settimana" e "Interventi".
2. In `doPost`: nel ciclo `ops.forEach` aggiungi la riga `else if (op.type === 'intervento') ...`
   e, dopo il ciclo, `try { avvisiImmediati(); } catch (err) {}` (copiali da qui).
3. In `doGet`: in cima le righe per `'programma'`, `'interventi'` e `'fotointervento'` (copiale da qui).
4. In `admin_`, nello `switch`: i `case` da `'programma'` a `'fotointervento'` (copiali da qui).
5. Salva, poi **Gestisci deployment → ✏️ → Nuova versione → Esegui il deployment**.
6. Esegui una volta **attivaAvvisiImmediati** e autorizza: Google chiede anche il permesso
   per **Google Drive**, serve per salvare le foto degli interventi.

## Codice di accesso (da fare per primo)
Senza codice chiunque conosca l'indirizzo dello script può inviare timbrature false o leggere interventi e programma.
1. Copia da `Codice.gs` la sezione "Codice di accesso" (funzioni `codiceOk_` e `attivaCodiceAccesso`),
   le righe che la usano in `doPost` e `doGet`, il `case 'codice'` e la riga `codice:` nel `default` di `admin_`.
2. Salva e pubblica una **nuova versione** del deployment.
3. Esegui una volta **attivaCodiceAccesso**: nel registro di esecuzione compare il link di invito.
4. Il telefono del responsabile si abilita da solo entrando nell'Area responsabile.
   Poi: Area responsabile → **🔗 Link di invito per gli operatori** → Invia su WhatsApp a ogni operatore,
   che lo apre una volta sul suo telefono.
Da quel momento i telefoni senza link non possono più inviare né leggere niente.

## Aggiornamento: DPI e vestiario, ore settimanali degli operatori
Nel file `Codice.gs` ci sono la sezione "DPI e vestiario" (schede DPI Capi, DPI Taglie, DPI Consegne),
i cinque `case 'dpi…'` in `admin_` e la colonna "Ore settimanali" nella scheda Operatori.
Si installa come le altre parti: caricare il file completo, rimettere ID del foglio, nome e telefono
del responsabile, salvare e pubblicare una **nuova versione** del deployment.
Il codice di accesso e gli altri dati restano (sono nelle proprietà dello script).

## Aggiornamento: timbrature di prova
Le timbrature fatte in modalità prova (colonna "Controllo sede" = PROVA) restano nel foglio ma non
fanno partire avvisi (immediati e serale) e non entrano in riepiloghi, extra da autorizzare e statistiche.
Si installa insieme alle altre parti con il file completo `Codice.gs`.

## Aggiornamento: cantiere fisso degli operatori
Scheda Operatori, colonna D "Cantiere fisso": l'app dell'operatore mostra subito quel cantiere
e con la card timbra direttamente lì. Si imposta dall'app (Programma → Operatori).
Si installa con il file completo `Codice.gs` e una nuova versione del deployment.

## Aggiornamento: committenti dei cantieri
Scheda Cantieri, colonna E "Committente": GEOFOR, ECOFOR SERVICE o ECOACCIAI (vuoto = GEOFOR).
Nell'app i cantieri sono raggruppati sotto i loghi dei committenti. Senza questa colonna l'app li
riconosce dal nome (chi contiene ECOFOR o ECOACCIAI, il resto Geofor).

## Aggiornamento: visite mediche e corsi di formazione
Schede "Scadenze Voci" (visite, corsi, abilitazioni e ogni quanti mesi si rinnovano) e "Scadenze"
(una riga per voce fatta, con la data e la scadenza). Si salvano solo le date, niente esiti sanitari.
Ogni lunedì l'avviso delle 20 aggiunge le voci scadute o in scadenza nei 60 giorni.
Le durate iniziali sono indicative per l'igiene urbana: vanno confermate con RSPP e medico competente.
Si installa con il file completo `Codice.gs` e una nuova versione del deployment.
