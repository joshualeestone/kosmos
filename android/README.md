# Kosmos for Android (Trusted Web Activity)

This is the Android store shell for Kosmos. It is a **Trusted Web Activity
(TWA)**: a thin, Google-blessed native app that renders the Kosmos board
full-screen with no browser chrome. It carries no hand-written app code, only
a launcher activity from `androidbrowserhelper` and four configuration values.

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
├── app/
│   ├── build.gradle                                   AGP 8.6.1, compile/target SDK 35
│   └── src/main/
│       ├── AndroidManifest.xml                        TWA LauncherActivity
│       └── res/values/strings.xml                     ← the ONLY file to edit to repoint
└── tools/
    ├── assetlinks.template.json                       host this at the front-door origin
    └── print-signing-fingerprint.sh                   fills the fingerprint in that file
```

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

**This skeleton builds.** `./gradlew :app:assembleDebug` was run against this
tree and produced a signed debug APK
(`app/build/outputs/apk/debug/app-debug.apk`, `io.kosmos.app` v0.1.0,
compileSdk 35).

The one catch is the JDK. The machine's **system-default** JDK is OpenJDK 26,
and the build fails on it: Gradle 8.9 starts fine, but its Groovy build-script
compiler cannot read JDK-26 bytecode and dies with

```
Unsupported class file major version 70
```

(major version 70 == Java 26). Current Gradle/AGP top out around JDK 21-23.

**The build was verified with OpenJDK 21**, installed keg-only so it does not
disturb the system-default 26:

```
brew install openjdk@21   # keg-only; already installed on this box
JDK21=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
JAVA_HOME="$JDK21" PATH="$JDK21/bin:$PATH" ./gradlew :app:assembleDebug
```

To make this the default for the build without touching the system JDK, set
`org.gradle.java.home` in `gradle.properties` to the JDK 21 path. It is left
unset here so the file stays machine-agnostic.

## Finishing the app (after the front-door origin is decided)

This skeleton points at the **placeholder** origin `https://app.kosmos.io/`
(open question #1 on #718). To ship for real:

1. **Set the real origin.** Edit `app/src/main/res/values/strings.xml`:
   `launchUrl`, `hostName`, and the `site` inside `assetStatements`. That is the
   only file to change.
2. **Confirm `applicationId`.** `io.kosmos.app` in `app/build.gradle` is the
   permanent Play identity; it cannot change after the first upload.
3. **Verify with Digital Asset Links.** Build a signed APK, then:
   ```
   tools/print-signing-fingerprint.sh            # debug key
   tools/print-signing-fingerprint.sh <release.keystore> <alias>   # release key
   ```
   Put that SHA-256 into `tools/assetlinks.template.json` and host the result at
   `https://<host>/.well-known/assetlinks.json`. If you use Play App Signing,
   use the fingerprint Play shows for its signing key, not the local upload key.
4. **The PWA must exist at that origin first.** The front-door origin has to
   serve the manifest and a **service worker** (the board does not have one
   yet, see #718). A TWA can install without one, but push and offline depend
   on it.

## Push

Push is delivered by the PWA's web-push, not by anything in this module. The TWA
inherits the web notifications the PWA registers. See the push section of the
#718 plan for the send path (outbound from the user's Mac, so it fits the relay
architecture without any inbound connection).
