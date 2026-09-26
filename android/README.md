# Kosmos for Android (Trusted Web Activity)

This is the Android store shell for Kosmos. It is a **Trusted Web Activity
(TWA)**: a thin, Google-blessed native app that opens Kosmos full-screen with no
browser chrome, starting at the Kosmos+ sign-in page (`login.kosmosplus.com`). It
carries no hand-written app code, only a launcher activity and a notification
delegation service from `androidbrowserhelper`, plus a few configuration values.

The reasoning for *why a TWA* (rather than a from-scratch native client or a
naive WebView wrapper) lives in the mobile plan on
[issue #718](https://github.com/joshualeestone/kosmos/issues/718). Read that
first; this README is the build-and-finish guide.

## What this is, in one paragraph

The board already runs on a phone browser and is already an installable PWA
(`web/manifest.webmanifest` + the PWA head in `web/index.html`). A TWA takes
that PWA and makes it a real Play-store app. Google supports this path
explicitly, so it does not hit the "just a repackaged website" rejection that a
plain WebView wrapper would. Android reaches the store on the PWA alone; iOS
cannot (that needs a separate native shell, deferred until Xcode exists).

## Layout

```
android/
├── settings.gradle, build.gradle, gradle.properties   Gradle project
├── gradlew, gradlew.bat, gradle/wrapper/              Gradle 8.9 wrapper (real jar)
├── gradle/gradle-daemon-jvm.properties                pins the daemon to JDK 21
├── app/
│   ├── build.gradle                                   AGP 8.6.1, compile/target SDK 35
│   └── src/main/
│       ├── AndroidManifest.xml                        LauncherActivity + push delegation
│       ├── res/mipmap-anydpi-v26/                     adaptive + round launcher icons
│       ├── res/drawable*/                              K foreground, splash + push icon
│       ├── res/xml/filepaths.xml                       shares the TWA splash with Chrome
│       ├── res/values*/                               light/dark system-bar + splash colours
│       └── res/values/strings.xml                     ← the ONLY file to edit to repoint
│                                                        (origin: login.kosmosplus.com)
└── tools/
    ├── assetlinks.template.json                       host this at the front-door origin
    └── print-signing-fingerprint.sh                   prints a keystore's SHA-256 for that file
```

## Android shell appearance

Android 8 and later use an adaptive launcher icon: a brand-gold background and
the transparent K mark held entirely inside Android's 66dp safe zone. The same
mark is supplied as the Android 13 monochrome layer, so themed icons use the
person's wallpaper palette instead of falling back to the legacy square PNG.
The legacy density PNGs remain the fallback for Android 7.

The launch activity supplies the same gold and K as both its native window
background and androidbrowserhelper's TWA splash metadata. This covers the
native handoff and Chrome's TWA startup without a white frame between them.
Android 12 and later also use the platform splash-screen attributes.
The private `FileProvider` exposes only the generated `twa_splash/` file to
Chrome, which Android Browser Helper requires to transfer the splash bitmap.

The status and navigation bars match the board tokens: `#faf9f7` in light mode
and `#0c0d0f` in dark mode. Both the activity theme and the TWA metadata read
qualified activity colours. The TWA dark metadata uses separate, explicit dark
resource IDs so Chrome receives `#0c0d0f` instead of reusing the light metadata
ID. The navy page content does not change between the evidence panels. The mode
proof is the Android-controlled top and bottom bars switching from the light
theme surface with dark controls to the near-black surface with light controls.

## Build toolchain (already installed on this box)

raiden installed the Android SDK; a fresh shell has these exported (in
`~/.zshrc`):

```
JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
PATH += platform-tools
```

Installed: cmdline-tools, platform-tools 37.0.1 (`adb`), build-tools 35.0.0,
platform android-35. There is **no system Gradle and no Android Studio** by
design, which is why this project ships the Gradle wrapper.

## Build status: verified green (with a JDK 21), and the JDK-26 catch

**This skeleton builds, and the JDK requirement is pinned in the repo so a fresh
clone builds too.** `./gradlew :app:assembleDebug` produces a signed debug APK
(`app/build/outputs/apk/debug/app-debug.apk`, `io.kosmos.app` v0.1.0,
compileSdk 35). No `JAVA_HOME` juggling is needed at the command line.

**Why the pin is necessary.** This box's system-default JDK is OpenJDK 26, and
Gradle cannot build on it: it starts, but its Groovy build-script compiler
cannot read JDK-26 bytecode and dies with `Unsupported class file major version
70` (70 == Java 26). Current Gradle/AGP top out around JDK 21-23. This module has
**no** Java or Kotlin source (a TWA is zero app code), so the JDK that matters is
the one **Gradle itself** runs on, not a compile toolchain.

**How it is pinned.** `gradle/gradle-daemon-jvm.properties` declares
`toolchainVersion=21`, so Gradle runs its daemon on JDK 21 even when launched
from the default JDK 26. `gradle.properties` then registers where this box's
JDK 21 lives (`org.gradle.java.installations.paths`) so the daemon criteria
resolve without a system symlink. Verified: `./gradlew :app:assembleDebug`
launched under the default JDK 26 builds green, because the daemon runs on 21.

**Per-machine note / portability.** The `org.gradle.java.installations.paths`
line in `gradle.properties` is the single machine-specific piece: it points at
this box's keg-only JDK 21 (`brew install openjdk@21`, which does not disturb
the default 26). The `toolchainVersion=21` criteria are machine-independent, but
Gradle 8.9's daemon criteria do **not** auto-download a JDK, so a JDK 21 must be
*present* on whatever machine runs the build:

- **Another dev machine:** repoint or remove the `installations.paths` line and
  let Gradle auto-detect an installed JDK 21, or install one.
- **CI:** a runner without a JDK 21 on that literal path will fail the daemon
  criteria. Provision JDK 21 on the runner (most CI Java actions do this) and,
  if its path differs, set `org.gradle.java.installations.paths` in the runner's
  own `~/.gradle/gradle.properties` or via `-Dorg.gradle.java.installations.paths=`.
  This is why the committed line is a per-box convenience, not a portable pin.

Android CI runs in `.github/workflows/android.yml`: on every push/PR touching
`android/**` it provisions JDK 21 (via `actions/setup-java`, which sets the
`JAVA_HOME` the daemon-JVM criteria auto-detect) and runs `:app:assembleDebug` as
an always-on advisory gate. A conditional `:app:assembleRelease` step signs only
when the upload-keystore secrets are present, and stays inert otherwise.

## Release signing (upload keystore)

`app/build.gradle` wires a **release** `signingConfig` to the Play **upload**
keystore. No key material or password lives in git — the build reads them at build
time from environment variables, and the keystore file itself lives under
`~/.config/secrets/` (mode 600), filed via `/add-secret`, never committed (also
covered by `android/.gitignore`'s `*.jks` / `*.keystore` / `*.p12` / `*.pfx` rules).

The build reads four env vars: `KOSMOS_UPLOAD_KEYSTORE` (path to the keystore),
`KOSMOS_UPLOAD_STORE_PASSWORD`, `KOSMOS_UPLOAD_KEY_PASSWORD`, and
`KOSMOS_UPLOAD_KEY_ALIAS` (optional; defaults to `kosmos-upload`). **If
`KOSMOS_UPLOAD_KEYSTORE` is unset the release build
stays unsigned** rather than failing to configure, so a fresh clone or a CI runner
without the keystore still builds; `assembleDebug` is never affected.

**Set the keystore and both passwords together, or not at all.** If
`KOSMOS_UPLOAD_KEYSTORE` is set but a password variable is missing (a partial env
— e.g. you resolved the keystore path but forgot the `eval` of the signing
credential), the release build **stays unsigned and prints a `WARN`** naming the
missing variable, rather than signing with a null password and failing later with
an opaque packaging error. So a release APK that came out unsigned when you meant
to sign it means the env was incomplete — check the warning, resolve the
`kosmos-android-upload-signing` credential, and rebuild.

On this box the material is in the agent secrets map under two targets — resolve
them straight into the environment (values never touch the command line):

```
# keystore path (file-path credential) + store/key passwords + alias (env credential)
export KOSMOS_UPLOAD_KEYSTORE="$(secrets-map.sh path kosmos-android-upload-keystore)"
eval "$(secrets-map.sh env kosmos-android-upload-signing)"
./gradlew :app:assembleRelease          # produces a signed release APK
```

Verify the signature with `apksigner` from build-tools:

```
$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

**Provisioning elsewhere.** The keystore is intentionally not in the repo. On
**another developer machine** provision it out-of-band and set the same four env
vars this section uses (`KOSMOS_UPLOAD_KEYSTORE` as a file path, plus the two
passwords and the alias). In **GitHub Actions CI** the shape differs, because a
secret is text and cannot be a binary file path: `.github/workflows/android.yml`
expects `KOSMOS_UPLOAD_KEYSTORE_BASE64` (the `.jks` base64-encoded),
`KOSMOS_UPLOAD_STORE_PASSWORD`, `KOSMOS_UPLOAD_KEY_PASSWORD`, and
`KOSMOS_UPLOAD_KEY_ALIAS` as repo secrets, and the workflow decodes the blob to a
runner-local file and points `KOSMOS_UPLOAD_KEYSTORE` at it. Provisioning those
secrets is a repo-admin decision and is not yet done. The upload key is `RSA-4096`,
alias `kosmos-upload`, valid to 2054. With **Play App Signing** this upload key is
resettable by Google if ever lost; it is the upload key, not the distributed
app-signing key.

## The origin and Digital Asset Links

The app opens the Kosmos+ coordinator, `https://login.kosmosplus.com/`: the one
fixed front-door origin picked on #2854 (Liu Kang, 2026-09-24). It is the page
every user already signs in on, and it already serves the push vapid key and the
subscribe route. The origin lives in `app/src/main/res/values/strings.xml`
(`launchUrl`, `hostName`, and the `site` inside `assetStatements`) and nowhere
else in this module.

For the app to open that page full-screen (no URL bar), the coordinator must serve
`https://login.kosmosplus.com/.well-known/assetlinks.json`. The exact content is
`tools/assetlinks.template.json`: package `io.kosmos.app` and the SHA-256 of the
certificate that signed the installed APK. Serving rules Chrome enforces: HTTPS
with a valid certificate, a 200 with **no redirect**, `Content-Type:
application/json`, and no auth.

Which fingerprints go in that list:

- **The upload key** (`21:4A:61:...:78:E8`, #3447) covers any APK built here with
  `assembleRelease`, for example one sideloaded for testing.
- **The Play app-signing key**, added once the app is on Play. With Play App
  Signing, Play re-signs the app, so a Play install is signed by Google's key, not
  ours; without that fingerprint in the list every Play install shows a URL bar.
  Read it from Play Console, App integrity, App signing key certificate.
- Never the debug key in production: it is per-machine and public.

Re-measure a fingerprint rather than copying it:

```
tools/print-signing-fingerprint.sh            # debug key
KEYSTORE_PASS=... tools/print-signing-fingerprint.sh <release.keystore> <alias>
$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner verify --print-certs <apk>
```

**Confirm `applicationId` before the first Play upload.** `io.kosmos.app` in
`app/build.gradle` was chosen to mirror the old placeholder origin. It becomes the
permanent Play identity at the first upload and cannot change afterwards.

## Push (notification delegation)

Push itself is the coordinator's web push, not anything in this module: the
coordinator's service worker (`/sw.js`) receives it and shows the notification.
What this module adds is **notification delegation**: `AndroidManifest.xml`
declares androidbrowserhelper's `DelegationService` and
`NotificationPermissionRequestActivity`. With them, Chrome hands web notifications
from the verified origin to this app, so they appear under **Kosmos's** name and
status-bar icon (`res/drawable/ic_notification.xml`) and use the app's own
notification permission on Android 13+. Without them they would show as Chrome
notifications. Still zero hand-written Java or Kotlin.

**Not yet seen on a device.** What is verified is the build: the release APK's
manifest carries the service, the activity and the icon. No push has been shown on
a phone or emulator yet, and delegation cannot work at all until the coordinator
serves `assetlinks.json` (above).

**Where a tap goes (open, not decided here).** The coordinator's `sw.js` opens
`https://<mac-name>.kosmosplus.com/` on a tap, the person's own Mac, which is a
different origin from `login.kosmosplus.com`. Per-Mac origins cannot be listed in
this app's verified set (one subdomain per user, and Digital Asset Links has no
wildcards), so that page is expected to open with a URL bar or in a browser tab
rather than as the bare app. Expected, not yet measured on a device. This is the same undecided half of #2854 as how the board is shown
after sign-in, and it stays with the relay architecture decision.
