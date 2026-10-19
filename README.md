# Timbra Cantieri

App per le timbrature di cantiere, ottimizzata per telefono e con supporto ai tag NFC.

## Come si usa
- **Entrata:** tocca *Entrata* sul cantiere, oppure passa il telefono sul tag NFC e scegli il cantiere.
- **Uscita:** ripassa il telefono sul tag: il turno si chiude da solo, con il pulsante "Annulla" se hai sbagliato.
- Tocca una timbratura nel registro per correggere orari o cantiere.
- Menu ⋯ → esporta in Excel (CSV), backup e ripristino, link per il tag NFC.

## Tag NFC
Scrivi sul tag (app **NFC Tools** → Scrivi → URL/URI) il link mostrato in Menu ⋯ → *Link da scrivere sul tag NFC*:
`https://grandoniandrea.github.io/timbra-cantieri/?nfc=1`

## Dati
I dati restano nel browser del telefono (localStorage). Fai un backup ogni tanto dal menu.

## Sviluppo
Sito statico, nessuna build: `index.html`, `style.css`, `app.js`, `sw.js`.
Prova in locale con `python3 -m http.server 8765`.
A ogni rilascio cambia `VERSION` in `sw.js`.
