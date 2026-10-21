# Timbra Cantieri – app Android e iPhone

È la stessa app web della cartella principale, impacchettata con Capacitor.

## Android (file APK di prova)
Si crea da solo su GitHub a ogni modifica dell'app: GitHub Actions → workflow "App Android di prova".
Il file si scarica dalla pagina **Releases** del repository, versione `android-prova`.
Sul telefono Android: scaricare l'APK, aprirlo e consentire "Installa app sconosciute".

## iPhone (prova gratuita con Xcode sul Mac)
1. Installare Xcode dall'App Store del Mac e Node.js.
2. In questa cartella: `npm install`, poi `npx cap add ios`, poi `npm run ios`.
3. `npx cap open ios` apre il progetto in Xcode.
4. In Xcode: Signing & Capabilities → Team = il proprio Apple ID (Personal Team), collegare l'iPhone e premere ▶.
5. Sull'iPhone: Impostazioni → Generali → VPN e gestione dispositivi → autorizzare lo sviluppatore.
Con l'Apple ID gratuito l'app dura 7 giorni, poi si reinstalla da Xcode.

## Icone
`assets/logo.png` è l'origine di icone e schermata di avvio (`npx capacitor-assets generate`).
