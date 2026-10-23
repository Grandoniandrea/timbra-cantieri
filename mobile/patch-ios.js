// Prepara il progetto iPhone (cartella ios, non salvata su git) per Xcode 27 / iOS 27.
// Se la cartella ios manca la crea con "npx cap add ios", applica le correzioni e poi "npx cap sync ios".
// Si può lanciare più volte: ogni correzione viene fatta solo se manca.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const iosDir = path.join(__dirname, 'ios');
const appDir = path.join(iosDir, 'App');
// CocoaPods si blocca se la lingua del terminale non è UTF-8
const env = { ...process.env, LANG: (process.env.LANG || '').includes('UTF-8') ? process.env.LANG : 'en_US.UTF-8' };
const run = (cmd) => execSync(cmd, { cwd: __dirname, stdio: 'inherit', env });

if (!fs.existsSync(appDir)) {
  console.log('Cartella ios assente: npx cap add ios');
  run('npx cap add ios');
}

function patch(rel, fn) {
  const file = path.join(appDir, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log('Corretto:', rel);
  } else {
    console.log('Già a posto:', rel);
  }
}

// 1. Podfile: iOS minimo 15, anche per tutti i Pods (Xcode 27 rifiuta versioni più vecchie)
patch('Podfile', (s) => {
  s = s.replace(/platform :ios, '[\d.]+'/, "platform :ios, '15.0'");
  if (!s.includes("build_settings['IPHONEOS_DEPLOYMENT_TARGET']")) {
    s = s.replace(/(\n\s*assertDeploymentTarget\(installer\)\n)/, `$1  # Xcode 27 non accetta più iOS sotto la 15: forza la versione minima anche sui Pods
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
    end
  end
`);
    if (!s.includes("build_settings['IPHONEOS_DEPLOYMENT_TARGET']")) throw new Error('Podfile: post_install non trovato');
  }
  return s;
});

// 2. Progetto Xcode: iOS minimo 15 e niente sandbox per gli script (blocca lo script di CocoaPods)
patch('App.xcodeproj/project.pbxproj', (s) => s
  .replace(/IPHONEOS_DEPLOYMENT_TARGET = (?:1[0-4]|[0-9])(?:\.\d+)?;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;')
  .replace(/ENABLE_USER_SCRIPT_SANDBOXING = YES;/g, 'ENABLE_USER_SCRIPT_SANDBOXING = NO;'));

// 3. AppDelegate.swift: SceneDelegate che inoltra link e attività a Capacitor
patch('App/AppDelegate.swift', (s) => {
  if (s.includes('class SceneDelegate')) return s;
  return s.replace(/\s*$/, '\n') + `
// iOS 27 richiede il ciclo di vita a "scene": la finestra la crea UIKit dallo storyboard Main
// indicato in Info.plist (UIApplicationSceneManifest). Qui si inoltrano link e attività a Capacitor.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

}
`;
});

// 4. Info.plist: manifest delle scene (senza, iOS 27 chiude l'app all'avvio) e testi dei permessi
const plistKeys = {
  NSCameraUsageDescription: '<string>La fotocamera serve per le foto degli interventi.</string>',
  NSLocationWhenInUseUsageDescription: '<string>La posizione serve per verificare che la timbratura avvenga in sede.</string>',
  NSPhotoLibraryUsageDescription: '<string>Le foto servono per documentare gli interventi.</string>',
  UIApplicationSceneManifest: `<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<false/>
		<key>UISceneConfigurations</key>
		<dict>
			<key>UIWindowSceneSessionRoleApplication</key>
			<array>
				<dict>
					<key>UISceneConfigurationName</key>
					<string>Default Configuration</string>
					<key>UISceneDelegateClassName</key>
					<string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
					<key>UISceneStoryboardFile</key>
					<string>Main</string>
				</dict>
			</array>
		</dict>
	</dict>`,
};
patch('App/Info.plist', (s) => {
  for (const [key, value] of Object.entries(plistKeys)) {
    if (s.includes(`<key>${key}</key>`)) continue;
    s = s.replace(/\n<\/dict>\s*<\/plist>\s*$/, `\n\t<key>${key}</key>\n\t${value}\n</dict>\n</plist>\n`);
    if (!s.includes(`<key>${key}</key>`)) throw new Error('Info.plist: fine del dict non trovata');
  }
  return s;
});

// Reinstalla i Pods con il Podfile corretto e copia l'app web
run('npx cap sync ios');
