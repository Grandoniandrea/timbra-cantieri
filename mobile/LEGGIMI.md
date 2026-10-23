# Timbra Cantieri – app Android e iPhone

È la stessa app web della cartella principale, impacchettata con Capacitor.
L'app carica la versione pubblicata su grandoniandrea.github.io/timbra-cantieri: ogni aggiornamento
dell'app web arriva da solo sui telefoni, senza reinstallare. Reinstallare l'APK serve solo quando
cambia la parte nativa (permessi, icona, plugin). Senza rete funziona con la copia salvata.

## Android (file APK di prova)
Si crea da solo su GitHub a ogni modifica dell'app: GitHub Actions → workflow "App Android di prova".
Il file si scarica dalla pagina **Releases** del repository, versione `android-prova`.
Sul telefono Android: scaricare l'APK, aprirlo e consentire "Installa app sconosciute".

## iPhone (prova gratuita con Xcode sul Mac)
Serve un Mac con Xcode (App Store), Node.js e CocoaPods (`brew install cocoapods`).

1. In questa cartella: `npm install`, poi `npm run ios`.
   Se la cartella `ios` manca la crea da sola, poi lancia `patch-ios.js`, che applica le correzioni
   per Xcode 27 / iOS 27 (iOS minimo 15, scene manifest e SceneDelegate, testi dei permessi,
   sandbox degli script spenta). Si può lanciare quante volte si vuole.
2. Sull'iPhone attivare la **Modalità sviluppatore**: Impostazioni → Privacy e sicurezza →
   Modalità sviluppatore → attiva, poi riavvio (compare solo dopo aver collegato l'iPhone al Mac con Xcode aperto).
3. Installare, a scelta:
   - **Da Xcode**: `npx cap open ios`, Signing & Capabilities → Team = il proprio Apple ID
     (Personal Team), scegliere l'iPhone collegato e premere ▶.
   - **Da terminale** (in `ios/App`, con l'iPhone collegato e sbloccato):
     ```
     xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath build DEVELOPMENT_TEAM=<ID team> ENABLE_USER_SCRIPT_SANDBOXING=NO -allowProvisioningUpdates build
     xcrun devicectl list devices
     xcrun devicectl device install app --device <UDID> build/Build/Products/Debug-iphoneos/App.app
     xcrun devicectl device process launch --device <UDID> it.grandoni.timbracantieri
     ```
     L'ID team si vede in Xcode (Settings → Accounts) ed è anche in `ios/App/App.xcodeproj` dopo il primo ▶ da Xcode.
     `ENABLE_USER_SCRIPT_SANDBOXING=NO` serve perché altrimenti Xcode blocca lo script di CocoaPods
     (`patch-ios.js` lo imposta già nel progetto; sulla riga di comando è una sicurezza in più).
4. Al primo avvio sull'iPhone: Impostazioni → Generali → VPN e gestione dispositivi → autorizzare lo sviluppatore.

Con l'Apple ID gratuito l'app dura 7 giorni, poi si reinstalla (passo 3).

## Icone
`assets/logo.png` è l'origine di icone e schermata di avvio (`npx capacitor-assets generate`).
