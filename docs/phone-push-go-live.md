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

Facts here were read from the code on 2026-09-24 (kosmos `main` at 8c4ca1d5, kosmos-relay `main` at
50a846b). The Android facts were re-read later that day at kosmos `main` 677eacde (the last commit
of #3644), and the asset-links facts at kosmos-relay `main` 6e2da95. The Android no-purchase
item was read on 2026-09-25 at kosmos-relay `main` 3558f2e. Both repos move on, so treat
the file and the name as what to search for, not the commit or the line.

## Where things stand today

- **The coordinator already has the code, but production does not run it yet.**
  - The APNs routes, the APNs sender and the sign-in page's session bridge are merged
    (kosmos-relay #104).
  - The Digital Asset Links file the coordinator serves for the Android app is merged too
    (kosmos-relay #109).
  - Production still runs build `2226c9d` (`curl -s https://coordinator.kosmosplus.com/v1/meta`),
    which has none of #103, #104 or #109.
- **The tunnel's `mac-request` verb is merged** (kosmos-relay #103). The board needs it to turn
  notifications on. No released Kosmos bundle carries it yet.
- **The board ships with notifications locked off.**
  - `PHONE_APP_CAN_RECEIVE` is `false` in `engine/phonenotify.js`.
  - While it is false the Settings section is hidden, turning on is refused, and nothing is sent.
- **The iOS app registers for notifications** (kosmos #3635) **and a tap opens the right Mac**
  (kosmos #3642), both merged. Neither has run on a simulator or a phone yet; step 4 has the
  simulator check.
- **The Android app shows notifications under its own name** (kosmos #3644, Sonya, merged). It
  opens `https://login.kosmosplus.com/` and delegates notifications to the app.

## Step 1. Josh's decisions and keys [Josh]

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

## Step 4. Get the iOS app onto testers' phones [Josh for signing and upload; fleet for the build]

**Setup (one time):**
- Set `DEVELOPMENT_TEAM` in `ios/Kosmos.xcodeproj` to the Kosmos Agent Manager, Inc. Team ID
  [Josh supplies the id; fleet makes the change]. It is absent today, and signing is `Automatic`.
  Signing under any other team gives device tokens the coordinator's key cannot send to.
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
  export for distribution is expected to set `production`. Check it on the exported app before
  upload: unzip the exported `.ipa` and run `codesign -d --entitlements - Payload/Kosmos.app`; it
  must show `production`.
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
- **Waiting on the iOS simulator runtime** (`xcodebuild -downloadPlatform iOS`): the app icon (the
  artwork is ready: `assets/Kosmos-1024.png`, 1024 px, full bleed, no transparency) and a navy
  launch screen. Both need an asset catalog, which does not compile on a Mac without the runtime.
  The store rejects an upload with no app icon, so this must land before the first TestFlight build.

**Build and upload:**
- Archive, then upload to TestFlight [Josh, or an agent holding upload access he grants].
- **The app's own choice of server:**
  - It reads its provisioning profile at runtime and tells the coordinator `sandbox` or
    `production`.
  - A TestFlight or App Store install should say `production`. That is reasoned from how Apple
    re-signs those builds, not yet measured.

**Pre-go-live check on the simulator** [fleet, once Josh has installed the iOS simulator
runtime with `xcodebuild -downloadPlatform iOS`]. The tap handler (kosmos #3642) has been built
and its address check tested, but the part that loads the board has never run. Run it on a
simulator before any real phone:
- Deliver a notification with `xcrun simctl push <device> io.kosmos.app payload.json`, where
  `payload.json` is `{"aps":{"alert":{"title":"Leo needs you","body":"in Kosmos"}},"address":"<mac>.kosmosplus.com","kind":"needs_you","id":"test:1"}`.
- Four cases, each landing on `https://<mac>.kosmosplus.com/`:
  1. a cold launch from the tap (app not running);
  2. a tap with the app open;
  3. the same payload pushed and tapped twice in a row, which should load the board both times;
  4. a tap while the biometric lock shows, which should land on the board after unlocking. This
     needs a test build with `KosmosConfig.requireBiometricUnlock` set to `true` (a constant,
     `false` in the shipped app).
- The device log shows `[Push] tapped notification opens <mac>.kosmosplus.com` for each.
- A payload whose `address` is not a Mac under `kosmosplus.com` leaves the app where it is.

**Check, on a phone with the TestFlight build:**
1. Open the app and sign in on the coordinator page.
2. Allow notifications.
3. The coordinator log shows the registration. With sending still held back, a later event shows
   `apns (log only, no key configured): would notify` in place of a real send.

**Undo:** expire the build in TestFlight. Nothing public has shipped.

## Step 5. Get the Android app onto testers' phones [Josh for the Play account, policy and deploys; fleet for the rest]

Sonya owns these facts (her message of 2026-09-24).

**Already on `main`:** notification delegation and the `https://login.kosmosplus.com/` launch URL
(kosmos #3644).

**The coordinator serves the Digital Asset Links file** [code merged; Josh for the deploy]:
- Where: `https://login.kosmosplus.com/.well-known/assetlinks.json`.
- How: plain HTTPS, 200 with no redirect, `Content-Type: application/json`, no auth.
- What it must say before a store release: package `io.kosmos.app`, relation
  `delegate_permission/common.handle_all_urls`, and two fingerprints (today it lists only the first):
  - the upload key's SHA-256 (`21:4A:61:04:67:09:08:20:B0:05:DC:40:D9:EC:EE:09:65:84:44:2E:40:AB:0F:DC:0F:EF:32:E6:EC:43:78:E8`);
  - the Play app-signing key's SHA-256, read from Play Console after the first upload.
- Never the debug key.
- The route is merged (kosmos-relay #109, `coordinator/src/assetlinks.rs`) but not live: production
  answers 404 until the coordinator is next deployed.
- It does not wait on Apple: the next coordinator deploy from `main` carries it [Josh, a production
  change]. Step 3 lists what a coordinator deploy turns on and off.
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

**No purchase inside the Android app** [code merged; Josh for the policy read and the deploy]
(kosmos #718, Liu Kang's decision of 2026-09-25, matching iOS; Josh can overrule it). Inside the
app the sign-in page is built to show no checkout, price or billing portal, and to tell an unpaid
account only "This account does not include Kosmos+ yet."; this has not yet been seen on a phone
(see Phone checks). It is the switch `CAN_BUY_HERE` in kosmos-relay `coordinator/src/signin.html`,
which came with kosmos-relay #117 for iOS and was extended to the Android app by kosmos-relay #121
(five commits).
- **Policy read** (Josh's call): before the first upload to any Play track, and again before the
  production release in Step 10, Josh reads the current Google Play Payments policy and its
  exceptions, against what the app does as described above. This doc deliberately states none of
  the policy's details: they change, they differ by country, and a summary written here would go
  stale unnoticed.
- **Not live yet:** it takes the next coordinator deploy [Josh, a production change], like the
  assetlinks route above, and that deploy must be live before the first upload to any Play track;
  otherwise the Play app shows checkout.
- **Undo (to show purchase in the Android app again):** revert all five commits of kosmos-relay
  #121 (iOS is unaffected), then deploy the coordinator [Josh, a production change]. Changing only
  the switch line back to `var CAN_BUY_HERE = !IN_IOS_APP;` is not enough: #121's Android tests in
  `coordinator/tests/page/signin.test.js` would then fail. Once an Android build is on any Play
  track, this puts checkout back inside a Play-distributed app.
- **Phone checks:** listed in kosmos-relay's plan `.claude/plans/android-no-purchase-718.md`
  ("Weakest part"; after an undo, read it from history); the full tester script is card kosmos
  #3699, to be corrected against a real phone.

**Upload:** to Play's Internal testing track [Josh, or whoever he gives Console access].

**Check:**
- `keytool -printcert -jarfile app-release.aab` shows the upload key's SHA-256. Sonya built and
  checked this AAB on the #3644 branch before it merged.
- `curl -sS -D- https://login.kosmosplus.com/.well-known/assetlinks.json`: read the body, not
  just the 200.
- Google's checker:
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://login.kosmosplus.com&relation=delegate_permission/common.handle_all_urls`.
- On a phone: install, sign in, allow notifications (the prompt should be the app's, not
  Chrome's). A push shows the Kosmos name and icon.
- Mortals has no emulator or phone for this today.

**Undo:**
- Remove the testing release in Play Console.
- For the no-purchase switch, see its own Undo line above.
- Removing the assetlinks route only brings back the URL bar. Nothing breaks.

## Step 6. Rebuild the tunnel with `mac-request` [fleet builds; shipping it is Josh's tunnel release]

This step is required before step 7, not optional housekeeping (Liu Kang posted the release order
on #718, 2026-09-24).

**Why:** turning notifications on makes the board ask the tunnel binary to sign a request to the
coordinator (`mac-request`). Since kosmos #3626 the Plus standing refresh and the update announce
use it too. Those two already fail in production today, because 0.6.91 sends them unsigned and the
coordinator refuses unsigned requests (Raiden measured the 401), so an old tunnel keeps them broken
rather than breaking them; a rebuilt tunnel is what turns #3626's fix on. The tunnel ships inside the Kosmos bundle
(`tools/build-kosmos-bundle.sh` takes `KOSMOS_TUNNEL_BIN`, default
`~/work/kosmos-relay/dist/kosmos-tunnel`).

**The copy on this machine is too old.** It was built from `9984170` and answers
`unrecognized subcommand 'mac-request'`. A board release cut from it today would ship a tunnel
that cannot turn notifications on. The board would then tell people "Kosmos on this computer
needs an update before phone notifications can be turned on" (`engine/phonenotify.js`).

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

## Step 7. The board release that opens the lock [Josh signs off the release notes and the promote; fleet builds]

**Code change, one kosmos PR:**
- Flip `PHONE_APP_CAN_RECEIVE` to `true` in `engine/phonenotify.js`.
- In the same PR, rework `server.phonenotify-gate-718.test.js`. It is not one test:
  - "the gate ships closed in this commit" asserts the constant is `false`;
  - the three "gate closed: ..." tests rely on the module's default being closed and never close
    it themselves.
  They all fail when the constant flips. Close the gate explicitly in those three
  (`setAvailableForTests`), and change the first to assert the new shipped value.
- Only do this once steps 4 and 5 have an app that receives. The lock exists so that no Mac
  sends before a phone can hear it.

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

**Kano's pipeline check:**
- The pipeline check lives in kosmos-relay (`docs/live-push-check.sh`, run as step 6 of
  `docs/demo-runbook.md`). It proves Mac, to coordinator, to push service, to the screen, on a
  local coordinator with Chrome web push.
- It has no APNs part and does not touch production.
- Kano is writing the end-to-end check for the app path in kosmos-relay `docs/`. Use his doc for
  that; it is not repeated here.

**The live check, on the real services:**
1. A Mac on the new board turns notifications on.
2. A phone with the TestFlight or internal Android build is signed in to the same account.
3. An agent on that Mac reports `needs_you`.
4. The phone shows "<agent> needs you".
5. Tapping it opens that Mac's board. If the app has not been signed in to that Mac before, the
   Mac's own sign-in gate appears instead.
6. Turning notifications off on the Mac stops the next one.

**Undo:** step 8's undo stops all sending.

## Step 10. Public app releases [Josh]

- **iOS:** App Store review and release. A phased release can be paused in App Store Connect.
- **Android:** Production track, as a staged rollout (for example 10%). First, Josh reads the Play
  Payments policy again (Step 5, "No purchase inside the Android app").
  - "Halt rollout" stops new installs. Anyone who already has it keeps it.
  - A fix ships as a new build with a higher `versionCode`. An older one cannot be re-published.
  - Because the Android app is a shell around the website, most problems are fixed by a server
    deploy, with no app release.

## Known gaps (not decided here)

- **A tapped Android notification opens the Mac's own address**
  (`https://<mac>.kosmosplus.com/`). Only `login.kosmosplus.com` is the app's verified origin, so
  the Mac's page opens with a URL bar. That is the undecided half of #2854 (Splinter and Josh).
- **iOS has no Approve or Deny buttons on a notification yet.** The Mac does not say whether a
  `needs_you` is a permission prompt.
- **One coordinator doc is out of date.** kosmos-relay `docs/coordinator-api.md` still says web
  push goes to "a PushSender that tonight logs". `coordinator/src/main.rs` sends for real.
