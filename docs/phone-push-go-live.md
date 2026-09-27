# Phone notifications: the go-live checklist (#718)

This is the one ordered list of what has to happen, and who does it, to turn phone
notifications on for real people. Push lives in the Kosmos phone apps only, not the website
(Josh, 2026-09-24). Five pieces have to line up: the coordinator, the tunnel, the board, the
iOS app and the Android app.

Every step says who can do it:

- **[Josh]**: needs Josh. That covers an account or key only he holds, a production change, or
  something published under his name.
- **[fleet]**: an agent can do it and report back.

Every step also says how to check it worked and how to undo it. Do the steps in order. A step
that fails stops the list: undo it, fix the cause, and start that step again.

Facts here were re-read on 2026-09-27 from kosmos `main` at `1901b9e57`,
kosmos-relay `main` at `ad43f2a0`, the live coordinator's `/v1/meta`, and the
deploy rows on #3763. Both repos move on, so the named files and checks are
the durable references. Commit ids say exactly what was checked this time.

## Where things stand today

- **The live coordinator is still build `660ef70`.** Its `/v1/meta` says so.
  The #3763 queue says relay #169, #172, #173 and both halves of #174 are not
  live. Relay #171 is also later than the live build. One coordinator deploy
  from current relay `main` turns on compressed public pages, the full-screen
  Android handoff, the tested push transport and pruning, and #174's
  notification-tap routing. Relay #170's Mac-offline answer is relay-server
  code, so it needs the separate relay deploy in Step 3c. Neither deploy ships
  #174's `gate.html`, which is tunnel code and waits for the Mac release.
- **Production web push is real, while APNs registration remains off.**
  `coordinator/src/main.rs` selects `VapidSender` unless `KOSMOS_PUSH=log`.
  The four APNs settings remain commented in
  `deploy/kosmos-coordinator.env.template`, so `KOSMOS_APNS_BUNDLE_IDS` allows
  no iOS app registration. Steps 2, 3 and 8 describe the separate APNs rollout.
- **The next Mac/tunnel release must contain two merged tunnel changes.** They
  are relay #161's per-Mac asset links and #174's sign-in gate that preserves
  the waiting agent. `PHONE_APP_CAN_RECEIVE` is now `true` in
  `engine/phonenotify.js` (Josh approved #4194; phonegate-4194). A Mac release
  carrying it shows the Phone notifications setting (off by default), with a
  line saying the phone app is in testing.
- **Android vc3 is built and proven.** The signed `io.kosmos.app` versionCode 3,
  versionName 0.1.2 APK is in Liu Kang's Files. Evidence in
  `android/evidence/vc3-4165/` proves install over vc2, sign-in, offline Retry,
  and a real notification with the Kosmos icon. Evidence in
  `android/evidence/tap-agent-4171/` proves the APK opens the waiting agent.
- **The iOS shell is implemented but has no signed phone build.** It registers
  for notifications and routes a tap to the named Mac. Apple organisation,
  signing and TestFlight steps remain in Steps 1 and 4.

## Step 1. Josh's decisions and keys [Josh]

**Turns on after:** nothing by itself. These decisions and credentials are
inputs to the coordinator env deploy in Steps 2 and 3 and the signed iOS build
in Step 4.

These have to exist before anything else. None of them is something an agent can create.

**Apple.** Everything Apple for Kosmos comes from a new Apple Developer organisation,
**Kosmos Agent Manager, Inc.** (the Kosmos legal entity), which is waiting for Apple's approval
(Liu Kang, from Splinter and Josh, 2026-09-24). None of it comes from the Stone Syndicate team. That
covers the team, the App ID, the provisioning profile and the .p8. Nothing else in this list waits
on the approval, and development keeps testing against Kano's mock APNs meanwhile.

1. **Apple approves the Kosmos Agent Manager, Inc. developer org.** Josh confirms it is active and
   notes its **Team ID**.
2. **Register the App ID `io.kosmos.app` under that org, with Push Notifications turned on.**
   - The bundle id is fixed in `ios/Kosmos.xcodeproj/project.pbxproj`
     (`PRODUCT_BUNDLE_IDENTIFIER = io.kosmos.app`), and it is what `KOSMOS_APNS_BUNDLE_IDS` allows
     (step 2).
   - It becomes permanent once an App Store Connect app record exists. Josh creates that record
     under the same org. The seller name on it can be set only once.
3. **Create the APNs authentication key (.p8) under that org.** Note its **Key ID**. The Team ID is
   the org's, from item 1.
   - It is filed with `/add-secret` by Liu Kang and read by lookup target only, never pasted
     (kosmos-relay `.claude/plans/apns-718.md`).
   - These values go into the coordinator's `KOSMOS_APNS_KEY_ID`, `KOSMOS_APNS_TEAM_ID` and
     `KOSMOS_APNS_KEY_PATH` in steps 2 and 3.
4. **Create a push-enabled provisioning profile for `io.kosmos.app` under that org**, plus the
   signing certificate it needs. The team's id is what step 4 sets as `DEVELOPMENT_TEAM`.

**Google**

5. **A Google Play Console developer account.** Sonya has seen no evidence one exists
   (2026-09-24).
6. **Confirm the Android application id `io.kosmos.app`** (`android/app/build.gradle`). Liu Kang
   decided to keep it (relayed by Sonya, 2026-09-24). It becomes permanent at the first Play upload,
   so Josh's yes is still the gate.
   - The Android upload key already exists (RSA-4096, alias `kosmos-upload`). Nothing to make.
   - Its secrets-map targets are `kosmos-android-upload-keystore` and
     `kosmos-android-upload-signing`.

**Check:**
- `secrets-map.sh lookup <target>` finds the APNs key (the target name is whatever `/add-secret`
  records).
- The App ID shows Push Notifications enabled in the Kosmos Agent Manager, Inc. account.
- The push-enabled provisioning profile and its signing certificate (item 4) exist in that account.
- Josh has said yes to items 1, 2, 5 and 6.

**Undo:** revoke the APNs key and the profile in the developer account. An App Store Connect app
record and its seller name cannot be undone, which is why item 2 is Josh's decision.

## Step 2. Put the APNs settings into the coordinator's env template [fleet]

**Turns on after:** the coordinator deploy in Step 3. A Mac release or APK
cannot supply these server settings.

A kosmos-relay PR, reviewed like any other. The four `KOSMOS_APNS_*` lines are already in
`deploy/kosmos-coordinator.env.template` as commented placeholders with no values (Kano, kosmos-relay
d05a90b). This step fills them in, and adds `KOSMOS_PUSH=log`.

- **Why a template change is needed.** The coordinator reads its settings from
  `/etc/kosmos-coordinator.env`, rendered from `deploy/kosmos-coordinator.env.template`, and
  today that template sets no push settings (the APNs lines are commented out).
- **Why not set the vars by hand on the box.** A var set by hand makes the next
  `INSTALL_ENV=1` deploy refuse, because that deploy will not drop a var the box has
  (`deploy/deploy-coordinator.sh`).

Fill these in, and add `KOSMOS_PUSH`. Each APNs name becomes a real `NAME=value` line, never a
`#NAME=` line: the deploy reads `#NAME=` as "deliberately unset" and would drop a value already on
the box (`deploy/deploy-coordinator.sh`: "Not #KEY= for KOSMOS_APNS_*"). Names are from
`coordinator/src/apns.rs` and `coordinator/src/main.rs`.

| Variable | Value | What it does |
|---|---|---|
| `KOSMOS_APNS_BUNDLE_IDS` | `io.kosmos.app` | The apps allowed to register. Empty (the default) means nothing can register, and the route answers 400 "this app is not set up for notifications". |
| `KOSMOS_APNS_KEY_ID` | from step 1 | The .p8 key's id. |
| `KOSMOS_APNS_TEAM_ID` | from step 1 | The Apple team. |
| `KOSMOS_APNS_KEY_PATH` | a file path on the box | Where the .p8 is read from. It is read from a file, never an env value, and never logged. |
| `KOSMOS_PUSH` | `log` | Keeps every send to a log line for now. This one value covers both APNs and web push. |

**Three traps, each checked before step 3** (Kano, verified against kosmos-relay #104):
1. **`KOSMOS_APNS_BUNDLE_IDS` has no default.** If it is unset, every app registration gets a
   400 and nothing reaches a phone. It is set to `io.kosmos.app` in the same change as the key
   settings, never later.
   Check: the rendered env contains `KOSMOS_APNS_BUNDLE_IDS=io.kosmos.app`.
2. **The team and the key must match.** `KOSMOS_APNS_TEAM_ID` is the Kosmos Agent Manager, Inc.
   Team ID. `KOSMOS_APNS_KEY_ID` and the .p8 must be a key made in that same team. A mismatch gets
   `InvalidProviderToken` from Apple on every send.
   Check: the Key ID and the Team ID both come from the same step 1 account.
3. **`KOSMOS_PUSH=log` forces log-only whatever the key is.** Turning it off is its own step
   (step 8), not part of this one.

One .p8 covers both Apple's sandbox and production servers, so there is no separate development
key.

**What the coordinator does with these at startup:**
- It sends to Apple only when all three `KOSMOS_APNS_KEY_*` settings are present, the key file
  reads, and `KOSMOS_PUSH` is not `log`.
- It does not choose between Apple's sandbox and production servers. Each registered device
  says which one it uses (`environment`).

**The key file's location has to be checked on the box, not assumed.** The service runs with
`ProtectHome=yes` and `ProtectSystem=strict` (`deploy/kosmos-coordinator.service`). So the file
probably cannot sit under `/root` or `/home`, and the service user must be able to read it.

**Check:** review the template diff in the PR.
- `DRY=1` does not render the env; it only prints what the deploy would do.
- The real check comes in step 3. `INSTALL_ENV=1` renders the whole env from the template and
  checks it against the box. It refuses if a var the box has would be dropped.
- That check runs AFTER the new binary is installed and BEFORE the env file is replaced and the
  service restarts (`deploy/deploy-coordinator.sh`). A refusal leaves the new binary installed next
  to the old env, and the next restart would run it. After a refusal, put the old binary back with
  the restore command the deploy prints.

**Undo:** revert the PR.

## Step 3. Deploy the coordinator with sending held back [Josh]

**Carries:** the coordinator portions of relay #169, #171, #172, #173 and
#174, plus the APNs registration settings from Step 2. The #3763 rows are
the deployment record. This does not carry relay #161 or #174's `gate.html`,
because those are tunnel code for the Mac release in Steps 6 and 7.
The content checks are `coordinator/src/lib.rs` for public-page compression,
`coordinator/src/signin.html` for full-screen handoff behavior,
`coordinator/src/push.rs` for real delivery and pruning, and
`coordinator/src/sw.js` for notification-tap routing.

**Not done yet.** The coordinator has been deployed several times since this doc was written, but
always with the template as it stands, so no deploy so far has held sending back or turned on app
registration. This step is the first deploy after step 2's template change.

This is a production change. Tell Liu Kang before it happens (`.claude/plans/apns-718.md`,
"Shipping").

### 3a. Put the .p8 on the box [Josh]

No deploy step copies a key file, and the template only holds its path.
- Copy it to the path set in `KOSMOS_APNS_KEY_PATH`, owned by `kosmos-coordinator` (the unit's
  `User=`), mode 600.
- The unit's `ProtectSystem=strict` makes the filesystem read-only to the service, not
  unreadable, but `ProtectHome=yes` hides `/root` and `/home`. So use a path outside those, for
  example under `/etc/kosmos-coordinator/` or `/var/lib/kosmos-coordinator/`.
- **Check:** `sudo -u kosmos-coordinator test -r <path> && echo readable`.
- **Undo:** delete the file.

### 3b. Deploy

- **Command:** `INSTALL_ENV=1 bash deploy/deploy-coordinator.sh`, from a clean kosmos-relay
  `main`.
  - It builds on the box, keeps the previous binary, restarts, and checks health.
  - `DRY=1` previews it without changing anything.
- **What this turns on:** the registration routes go live, so an app can register. Nothing is
  sent to any phone yet, because `KOSMOS_PUSH=log`.
- **What this turns off:** browser web push, which is live in production today. Production has no
  `KOSMOS_PUSH` set, and the coordinator sends web push for real unless it is exactly `log`
  (`coordinator/src/main.rs`). The board no longer offers the browser sign-up (#3510), and no Mac
  sends events while the board's lock is closed, so nothing should be using it. It is still a
  production change, so it is named here.

**Check:**
- `curl -s https://coordinator.kosmosplus.com/v1/meta` shows the new `build`.
- `sh deploy/check-coordinator-health.sh` exits 0.
- On the box, `journalctl -u kosmos-coordinator` shows
  `apns: log only (KOSMOS_PUSH=log, or no APNs key configured)`.

**Undo:**
- **A refused env check (see step 2):** the new binary is already installed. Restore the old one
  with the printed command below, even though the service was not restarted.
- **Binary:** the deploy prints the exact restore command
  (`install -m755 <backup> /usr/local/bin/kosmos-coordinator && systemctl restart kosmos-coordinator`).
  It also rolls itself back if the restart fails. That automatic path has never actually run
  (`deploy-coordinator.sh`).
- **Env file:** `cp <ENV_BACKUP> /etc/kosmos-coordinator.env && systemctl restart kosmos-coordinator`.
- **Rehearsal:** `bash deploy/drill-rollback.sh` rehearses the binary restore against a copy of
  the database, read-only.

### 3c. Deploy the relay's Mac-offline answer [Josh]

Relay #170 changes `crates/relay/src/redirect.rs` and `crates/relay/src/serve.rs`,
not the coordinator. A relay deploy from current relay `main` makes plain HTTP
show the Kosmos “Mac is offline” answer when no tunnel is connected, instead
of sending a dead redirect. It needs no env change or migration. This deploy
does not alter the APK, Mac bundle or coordinator.

**Check:** exercise one address with no connected Mac and confirm the plain
HTTP response is the offline page; then confirm a connected Mac still receives
the request. Relay #170's `crates/e2e/tests/http_redirect.rs` is the code-level
control. Record the live build and rollback anchor on #3763 when deployed.

## Step 4. Get the iOS app onto testers' phones [Josh for signing and upload; fleet for the build]

**Carries:** a signed TestFlight build. It turns on native APNs registration
and tap handling on an iPhone after Step 3 allows the bundle id. It does not
open the Mac's send lock or make Step 8's log-only coordinator send for real.

**Done now, before Apple's approval (kosmos #4089):**
- **The Team ID has one home, `ios/Signing.xcconfig`** (`DEVELOPMENT_TEAM`, empty today). The Xcode
  project and the archive script both read it from there.
- **`ios/tools/archive.sh --build <N>`** archives, exports for App Store Connect
  (`ios/tools/ExportOptions.plist`) and checks the exported `.ipa`. `--upload` then sends that same
  checked file. Details are in `ios/README.md`, "Signing, archive and upload".
- **The push check on the exported app is automatic.** `ios/tools/check-ipa-entitlements.sh` runs
  inside `archive.sh`, and nothing uploads unless `aps-environment` reads `production` and the app
  is signed by the team in `ios/Signing.xcconfig`.
- **The app icon and the navy launch screen are in an asset catalog** (`ios/Kosmos/Assets.xcassets`,
  icon from `assets/Kosmos-1024.png`). It compiles on GitHub's macOS runner, and iOS CI checks the
  built app carries both. It does not compile on the Mac mini until an iOS runtime is installed
  there (`xcodebuild -downloadPlatform iOS`), which matters only for building on that Mac.

**Waits on Apple approving the org (#3643):**
- **Set `DEVELOPMENT_TEAM` in `ios/Signing.xcconfig`** to the Kosmos Agent Manager, Inc. Team ID
  [Josh supplies the id; fleet makes the change]. One line; signing is `Automatic`. Signing under
  any other team gives device tokens the coordinator's key cannot send to.
- **The App Store Connect app record** for `io.kosmos.app`, under that org [Josh: the seller name
  is permanent, Step 1 item 2].
- **An App Store Connect API key** for the upload (`ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`),
  filed with `/add-secret` [Josh creates it; it can upload builds under his org]. Without one,
  `archive.sh` still exports and checks, and the checked `.ipa` goes up through Apple's Transporter
  app.

**Setup (one time):**
- The entitlement file `ios/Kosmos.entitlements` already asks for push
  (`aps-environment = development`). Xcode switches it to production when the build is
  exported for distribution.

**What to have settled before the first upload (decisions are named where they are someone's; the facts are checked):**
- **Version.** The code says `0.1.0`, build `1` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`).
  The version the store shows at submission is Josh's call. The build number must go up on every
  upload.
- **Export compliance (encryption).** Not set in the code on purpose: it is a declaration to Apple
  that Josh makes, in App Store Connect on upload (or later as `ITSAppUsesNonExemptEncryption` in
  the build settings). The facts, read from `ios/Kosmos/` on 2026-09-25: the app talks to the
  network only over HTTPS through Apple's own `URLSession` and `WKWebView`, keeps the session in the
  iOS Keychain, and contains no encryption code of its own.
- **Push entitlement.** `ios/Kosmos.entitlements` says `aps-environment = development`, and the
  export for distribution is expected to set `production`. `archive.sh` checks the exported `.ipa`
  and stops before upload if it does not (`ios/tools/check-ipa-entitlements.sh`; by hand, unzip the
  `.ipa` and run `codesign -d --entitlements - Payload/Kosmos.app`).
- **iPhone only.** The app targets iPhone only (`TARGETED_DEVICE_FAMILY = 1`, Liu Kang,
  2026-09-25): iPad layouts are not designed or tested, and no iPad screenshots are needed. iPad is
  not ruled out, though: an iPhone-only app still installs on an iPad in a scaled iPhone window, App
  Review can test it there, and it is offered on Apple silicon Macs unless that is turned off in App
  Store Connect. Widening to iPad later is one setting.
- **Permission strings.** Camera, microphone, adding to Photos and Face ID each have a sentence in
  the build settings, and iOS CI checks them in the built app (`ios/tools/check-usage-strings.sh`).
  Without one, iOS closes the app when a photo picker, a long-pressed image or the Face ID unlock
  uses it.
- **No purchase inside the app.** The sign-in page hides checkout, prices and the billing portal
  inside the iOS app (kosmos-relay #117). Anything said to App Review about where Kosmos+ is sold
  is Josh's.
- **App icon and launch screen.** In the asset catalog and checked in CI (above). The store rejects
  an upload with no app icon; that is now covered.

**Build and upload:**
- `ios/tools/archive.sh --build <N> --upload`, with the build number higher than any uploaded
  before [Josh, or an agent holding the upload key he grants].
- **The app's own choice of server:**
  - It reads its provisioning profile at runtime and tells the coordinator `sandbox` or
    `production`.
  - A TestFlight or App Store install should say `production`. That is reasoned from how Apple
    re-signs those builds, not yet measured.

**On-device check:** use Sonya's single phone script on #4184,
`android/phone-test-checklist.md`, once a signed iOS build exists. That script
owns the user-visible sequence and screenshots. This guide only owns which
deploy or release makes each capability available.

**Undo:** expire the build in TestFlight. Nothing public has shipped.

## Step 5. Get the Android app onto testers' phones [Josh for the Play account, policy and deploys; fleet for the rest]

**Carries:** the signed vc3 APK, independently of a coordinator or Mac release.
It is already in Liu Kang's Files. Installing it turns on the native launcher,
browser warmup, native offline Retry page, Kosmos notification icon, and the
agent deep-link receiver. Full-screen handoff and tap routing also require the
coordinator deploy in Step 3; a signed-out deep link retaining its agent also
requires the tunnel/Mac release in Steps 6 and 7.

**Already on `main`:** notification delegation, the
`https://login.kosmosplus.com/` launch URL, Kosmos icon resources and the
waiting-agent receiver. `android/evidence/vc3-4165/` and
`android/evidence/tap-agent-4171/` record the AVD proofs.

**The coordinator serves the Digital Asset Links file** [code merged; Josh for the deploy]:
- Where: `https://login.kosmosplus.com/.well-known/assetlinks.json`.
- How: plain HTTPS, 200 with no redirect, `Content-Type: application/json`, no auth.
- What it must say before a store release: package `io.kosmos.app`, relation
  `delegate_permission/common.handle_all_urls`, and two fingerprints (today it lists only the first):
  - the upload key's SHA-256 (`21:4A:61:04:67:09:08:20:B0:05:DC:40:D9:EC:EE:09:65:84:44:2E:40:AB:0F:DC:0F:EF:32:E6:EC:43:78:E8`);
  - the Play app-signing key's SHA-256, read from Play Console after the first upload.
- Never the debug key.
- The route is live (kosmos-relay #109, `coordinator/src/assetlinks.rs`). Measured on 2026-09-25:
  200 with no redirect, `Content-Type: application/json`, listing the upload key only.
- It serves the upload key only. The fingerprints are a constant in code
  (`CERT_SHA256_FINGERPRINTS`), so adding the Play key after the first upload is a kosmos-relay PR
  and another coordinator deploy [fleet for the PR; Josh for the deploy].

**Build** [fleet, on Mortals, from `android/`]:
```
export KOSMOS_UPLOAD_KEYSTORE="$(secrets-map.sh path kosmos-android-upload-keystore)"
eval "$(secrets-map.sh env kosmos-android-upload-signing)"
./gradlew :app:bundleRelease     # app/build/outputs/bundle/release/app-release.aab
```
- Bump `versionCode` and `versionName` in `android/app/build.gradle` first. Play refuses a
  repeated `versionCode`.
- CI builds only APKs. Its signed-release step runs only once the GitHub secrets
  `KOSMOS_UPLOAD_KEYSTORE_BASE64`, `KOSMOS_UPLOAD_STORE_PASSWORD`, `KOSMOS_UPLOAD_KEY_PASSWORD`
  and (optionally) `KOSMOS_UPLOAD_KEY_ALIAS` exist. None are set. Setting them is a repo-admin
  call for Josh.

**No purchase inside the Android app** [live; Josh for the policy read]
(kosmos #718, Liu Kang's decision of 2026-09-25, matching iOS; Josh can overrule it). Inside the
app the sign-in page is built to show no checkout, price or billing portal; an unpaid account sees
"This account does not include Kosmos+ yet." where the pay step would be. On 2026-09-25 Sonya checked this on an
Android 15 emulator with the upload-key-signed app (kosmos #3699): purchase stays hidden inside the
app, including after a force-stop, and shows in plain Chrome. A signed-in unpaid account has not
been checked yet; that waits for Josh's first phone test. It is the switch `CAN_BUY_HERE` in kosmos-relay
`coordinator/src/signin.html`, which came with kosmos-relay #117 for iOS and was extended to the
Android app by kosmos-relay #121 (five commits).
- **Policy read** (Josh's call): before the first upload to any Play track, and again before the
  production release in Step 10, Josh reads the current Google Play Payments policy and its
  exceptions, against what the app does as described above. This doc deliberately states none of
  the policy's details: they change, they differ by country, and a summary written here would go
  stale unnoticed.
- **Live on the production coordinator** (confirmed on 2026-09-25 by the ancestry check below,
  against the `build` that `curl -s https://coordinator.kosmosplus.com/v1/meta` reports). On a Play install it likely also needs Play's app-signing key in
  assetlinks.json (the asset-links bullet above): without it the app opens as a browser tab, and
  whether the switch's signal arrives then is not confirmed. Before the first upload to any Play
  track, confirm it is still live [fleet]: take the `build` from that URL, run
  `git -C ~/work/kosmos-relay fetch -q origin`, then
  `git -C ~/work/kosmos-relay merge-base --is-ancestor 3558f2e <build> && echo live || echo "NOT live, or the check failed"`. A coordinator
  rollback to a build before `3558f2e` brings checkout back inside the app, the same as the undo
  below.
- **Undo (to show purchase in the Android app again):** revert all five commits of kosmos-relay
  #121, `eb06c19` through `3558f2e` inclusive (in git: `eb06c19^..3558f2e`; iOS is unaffected)
  [fleet for the revert PR], then deploy the coordinator [Josh, a production change]. That deploy
  ships whatever else is on `main` by then, not only the revert. Changing only the switch line back
  to `var CAN_BUY_HERE = !IN_IOS_APP;` is not enough: #121's Android tests in
  `coordinator/tests/page/signin.test.js` would then fail. Once an Android build is on any Play
  track, this puts checkout back inside a Play-distributed app.
- **Phone checks:** use Sonya's #4184 script,
  `android/phone-test-checklist.md`. Do not copy its sequence here.

**Upload:** to Play's Internal testing track [Josh, or whoever he gives Console access].

**Artifact checks:**
- `keytool -printcert -jarfile app-release.aab` shows the upload key's SHA-256. Sonya built and
  checked this AAB on the #3644 branch before it merged.
- `curl -sS -D- https://login.kosmosplus.com/.well-known/assetlinks.json`: read the body, not
  just the 200.
- Google's checker:
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://login.kosmosplus.com&relation=delegate_permission/common.handle_all_urls`.
- On a phone, follow #4184's `android/phone-test-checklist.md`.

**Undo:**
- Remove the testing release in Play Console.
- For the no-purchase switch, see its own Undo line above.
- Removing the assetlinks route brings back the URL bar, and may bring checkout back inside the app
  (see the no-purchase item above).

## Step 6. Rebuild the tunnel with `mac-request` [fleet builds; shipping it is Josh's tunnel release]

**Carries:** relay #161's per-Mac Digital Asset Links and relay #174's
`gate.html` deep-link preservation, as well as the already merged
`mac-request` verb. Building prepares these changes; only the Mac release in
Step 7 puts them on people's computers.

This step is required before step 7, not optional housekeeping (Liu Kang posted the release order
on #718, 2026-09-24).

**Why:** turning notifications on makes the board ask the tunnel binary to sign a request to the
coordinator (`mac-request`). Since kosmos #3626 the Plus standing refresh and the update announce
use it too. Those two already fail in production today, because 0.6.91 sends them unsigned and the
coordinator refuses unsigned requests (Raiden measured the 401), so an old tunnel keeps them broken
rather than breaking them; a rebuilt tunnel is what turns #3626's fix on. The tunnel ships inside the Kosmos bundle
(`tools/build-kosmos-bundle.sh` takes `KOSMOS_TUNNEL_BIN`, default
`~/work/kosmos-relay/dist/kosmos-tunnel`).

**The prepared copy on Mortals is not current enough for this cut.** Its
`dist/kosmos-tunnel.commit` is `1180088`, so it has `mac-request` and #161,
but it predates #174's `gate.html`. Rebuild it from current relay `main` before
the Mac cut. A released board with an older connector tells people “Kosmos on
this computer needs an update before phone notifications can be turned on”
(`engine/phonenotify.js`).

**Command:** in kosmos-relay at `main`, `bash tools/build-tunnel-release.sh`, which writes
`dist/kosmos-tunnel` plus `.commit` and `.sha256`.

**Check:**
- `dist/kosmos-tunnel mac-request --help` prints usage, not `unrecognized subcommand`.
- `dist/kosmos-tunnel.commit` contains `e39eeca`, the commit that added `mac-request`:
  `git -C ~/work/kosmos-relay merge-base --is-ancestor e39eeca "$(cat ~/work/kosmos-relay/dist/kosmos-tunnel.commit)"`.
- Before cutting step 7, run the same `mac-request --help` check against the binary the bundle
  build will actually use: `KOSMOS_TUNNEL_BIN` if it is set, otherwise the default path above.

**The bundle build also checks this** (`tools/lib/connector-verbs.sh`, called from
`tools/build-kosmos-bundle.sh`).
- While `PHONE_APP_CAN_RECEIVE` is `false`, an old tunnel gets one line that starts "note: this
  Plus connector predates mac-request", and the build goes on. A tunnel it could not run to check
  gets one line that starts "note: could not check this Plus connector", and the build goes on too.
- Once it is `true`, the build refuses to bundle a tunnel without `mac-request`, and also one it
  could not run to check (not executable, killed, crashed, or silent for 20 seconds).
- The hand check above still comes first: a refused build at step 7 costs a release attempt.

**Undo:** nothing has shipped. The binary only reaches people inside a board release (step 7).

## Step 7. Decide whether to open the lock, then carry that decision in a board release [Josh decides; fleet implements and builds]

**Decided and implemented:** Josh approved #4194, and phonegate-4194 set
`PHONE_APP_CAN_RECEIVE` to `true`. That PR also reworked
`server.phonenotify-gate-718.test.js`, so the closed-gate tests close the gate
explicitly and a test pins the open value. It added the Settings line saying
the phone app is in testing.

**This release carries:** the rebuilt tunnel from Step 6 and the board with
the gate open. The bundle build refuses a gate-open bundle whose Plus connector
lacks `mac-request` (`tools/lib/connector-verbs.sh`), because turning phone
notifications on needs it. So the tunnel from Step 6 must be the one inside
this release.

**Before the staging cut, Josh signs off the release notes and site copy** [Josh].
- A staging cut is not private. `KOSMOS_CUT_CHANNEL=staging tools/release.sh` holds back only the
  download pointer; its site deploy publishes the site (the versions page entry and the install
  copy) to installkosmos.com straight away (seen on the 0.6.60 cut).
- So the "phone notifications" release notes go public under Josh's name at the staging cut,
  before any staging check has passed.

**Cut the release on staging first**, using the rebuilt tunnel from step 6
(`docs/staging-channel.md`):
```
KOSMOS_CUT_CHANNEL=staging bash tools/release.sh <version>
```

**Check, on a staging install**
(`curl -fsSL https://installkosmos.com/setup | KOSMOS_UPDATE_CHANNEL=staging sh`):
1. Settings, This computer, shows the "Phone notifications" section, with "Buzz my phone when
   an agent needs me" and a "Turn on" button. It is off by default.
2. Pressing Turn on succeeds. It mints the Mac's notify credential through the new tunnel.
3. Run the two staging gates in `docs/staging-channel.md`.

**Promote to everyone:** follow steps 4 and 5 of `docs/staging-channel.md` exactly.
- `tools/promote-channel.sh <site-checkout> <board-port>` rewrites `dist/latest.json` in the site
  checkout.
- Commit and push that file.
- Then run `bash tools/deploy-site.sh --promote`. It refuses if the committed pointer already
  equals the live one.
- Josh approves this, because it changes what every Mac downloads.

**Undo:**
- Point `latest.json` back at the previous release and redeploy the site
  (`docs/staging-channel.md`). No rebuild.
- That does not take back the site copy published at the staging cut. The versions page entry and
  the install copy stay until the site is redeployed without them.
- A Mac back on the old board has the lock closed again and sends nothing.

## Step 8. Let the coordinator send [Josh]

**Carries:** a second coordinator env deploy. This turns APNs delivery from
log-only to real sending after the apps and Mac release are ready. It changes
neither the APK nor the tunnel/Mac bundle.

**Command:** in `deploy/kosmos-coordinator.env.template`, change `KOSMOS_PUSH=log` to
`#KOSMOS_PUSH=` (declared unset), then redeploy with `INSTALL_ENV=1`.
- Do not simply delete the line. The coverage check refuses an env that drops a var the box has,
  unless the template declares it `#KEY=` (`deploy/deploy-coordinator.sh`).
- Do not edit the box's env file by hand either: that is the drift step 2 exists to avoid.
- Kano's plan ties this to the same moment as the tunnel release in step 7, not before.
- This also turns browser web push back on, as it is in production today
  (`coordinator/src/main.rs`). Browser web push is no longer a product, and nothing subscribes to
  it from the apps.

**Check:**
- `journalctl -u kosmos-coordinator` shows `apns: sending with token auth` with `bundles=1`.
  `bundles=0` means trap 1 (no bundle id allowed).
- The first real send is not rejected with `InvalidProviderToken`, which would mean trap 2 (the
  team and the key do not match).

**Undo:** put `KOSMOS_PUSH=log` back in the template and redeploy with `INSTALL_ENV=1`. Sending
stops once the service restarts.

## Step 9. Prove it end to end [fleet, with a person holding a phone]

Use Sonya's #4184 script, `android/phone-test-checklist.md`, for the real
phone sequence, pass conditions and screenshots. Do not maintain a second
sequence here. Run only the portions whose carrier is live:

- vc3 artifact steps after installing the APK from Liu Kang's Files;
- coordinator-dependent steps after Step 3's deploy;
- signed-out agent preservation after Steps 6 and 7's Mac/tunnel release;
- real delivery after Step 8.

The relay's `docs/live-push-check.sh` remains a local Chrome web-push pipeline
check. It has no APNs part and does not replace #4184's phone script.

**Undo:** step 8's undo stops all sending.

## Step 10. Public app releases [Josh]

**Carries:** the already tested phone shell to public App Store or Play users.
Most page behavior still arrives through coordinator deploys, and Mac-side
notification behavior still arrives through Kosmos releases.

- **iOS:** App Store review and release. A phased release can be paused in App Store Connect.
- **Android:** Production track, as a staged rollout (for example 10%). First, Josh reads the Play
  Payments policy again (Step 5, "No purchase inside the Android app").
  - "Halt rollout" stops new installs. Anyone who already has it keeps it.
  - A fix ships as a new build with a higher `versionCode`. An older one cannot be re-published.
  - Because the Android app is a shell around the website, most problems are fixed by a server
    deploy, with no app release.

## Known gaps (not decided here)

- **Relay #175 is merged as `bc56ec8f`, but not live.** Its exact 16-byte
  auth-secret rule rides the next coordinator deploy, as recorded on #3763.
- **iOS shows no Approve or Deny buttons on a notification** (#3870). They were registered but
  nothing carried the choice to the Mac, so they are hidden for the first store submission.
  Building them for real needs an authenticated call from the phone to the Mac, a ruling on
  whether Face ID is required, and the Mac saying whether a `needs_you` is a permission prompt.
