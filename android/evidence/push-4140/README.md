# Android push on the Moto AVD (#4140)

A real Web Push, sent by the coordinator's real VapidSender (not `KOSMOS_PUSH=log`),
reached the Kosmos Android app on the Moto G Play 2024 AVD (API 35) on 2026-09-27
between 03:45 and 03:47 CDT. The notification was posted by the app, not by Chrome.
Two things are still wrong: it wears Chrome's small icon, and a tap opens Chrome with
a URL bar instead of the app.

## Setup

- AVD `moto-g-play-2024-api35`, headless, Chrome 124.0.6367.219.
- APK `io.kosmos.app` versionCode 2 / versionName 0.1.1 (the vc2 APK from #4132),
  pulled back off the device: SHA-256
  `cbc4c4ba6dd066dd4ce6efa7298d5d1921a5b526f2b19fda31c974cfa44a49ff`.
- The release APK always opens `https://login.kosmosplus.com/`, so the device's Chrome
  was pointed at a LOCAL dev coordinator (kosmos-relay at 1bc4017) with
  `--host-resolver-rules` (login.kosmosplus.com to a local HTTPS proxy via `adb reverse`)
  and a test certificate pinned by SPKI. Test account `kano-4140@kosmos.invalid`, no live
  account, nothing uploaded. The push was triggered through the Mac path
  (`/v1/mac/notify-credential`, then `/v1/mac/notify`, kind `needs_you`).
- All device changes were reverted afterwards: `debug_app` is null, the Chrome
  command-line file is gone, `adb reverse --list` is empty.

## What each screenshot shows

The numbers are the run's step order; steps 01 to 03 (launch and sign-in) and 06 (status bar)
are not kept because they show nothing this card is about.

| File | What it proves |
|---|---|
| `04-prompt.png` | The permission prompt reads "Allow **Kosmos** to send you notifications?", the app's own prompt through the delegation bridge, not Chrome's. |
| `05-after-allow.png` | Signed in to the local coordinator; the page says this phone will be notified. |
| `07-shade.png` | The push arrived: "Scorpion needs you, on Kosmos Inside Out". Header: `Kosmos · login.kosmosplus.com`. |
| `07-small-icon-crop.png` | Enlarged crop of the header icon in 07: it is Chrome's logo, not the Kosmos planet. |
| `08-tap.png` | The tap first showed Chrome's one-time "Enhanced ad privacy in Chrome" notice (Chrome proper, not the app). |
| `09-tap-page.png` | Then Chrome, with a URL bar, at `kano4140.kosmosplus.com/?tab=` (the bar cuts off there; the rest of the URL is not in the screenshot). ERR_CONNECTION_CLOSED is expected locally (no real tunnel); opening in Chrome is the finding. |

SHA-256:

```
ec113a55fe8810a4f2cc618ea0ca5af5ef35933cc436a19bb5c9f0b0c2a4b2a9  04-prompt.png
c1b9f293da02575732a8ac049fcd9f000e0e8047af0e3c29dd6829e81bd4640f  05-after-allow.png
571954c3c1bc0773c15b4aea34096559a3349c13f43cf0bef724e6708c79bf88  07-shade.png
d009b2bcefb34cb1037cb387a550556230873eb2b0ef06b401aa44f45f7e6b08  07-small-icon-crop.png
3b996c88f08b4e039e98b4cef465af69d8c9f6130187af8139b0f25a57d8a94f  08-tap.png
279276a4877e41eaf5e0c5a5f3036734fd6f82029d1851d5e5d4343436f35ec8  09-tap-page.png
```

## Finding 1: delegation works (the app posted it)

**Measured:** the usagestats record below.

`adb shell dumpsys usagestats` on the device:

```
time="2026-09-27 03:46:43" type=NOTIFICATION_INTERRUPTION package=io.kosmos.app channelId=general_channel_id
```

The notification was posted by `io.kosmos.app`, and the header's app name is "Kosmos".
The live notification itself was gone by the time this was checked (the tap dismissed it),
so `dumpsys notification` no longer lists it; usagestats is the durable record.

Note: when read at 03:55 CDT, `POST_NOTIFICATIONS` showed `granted=false` for both
`io.kosmos.app` and Chrome, and both packages were stopped. That is the state AFTER the
run, not during it (the push was shown and the prompt in 04 was allowed). What reset it
was not established.

## Finding 2: the small icon is Chrome's, and why

**Measured:** the icon in 07 is Chrome's logo; the APK's manifest and the library bytecode
read as below. **Reasoned, not measured:** that this is the cause.

The installed APK does declare `android.support.customtabs.trusted.SMALL_ICON` on
`DelegationService`, pointing at `@drawable/ic_notification` (checked with `aapt2 dump
xmltree` on the pulled APK). But that drawable is a **vector** (`ic_notification.xml`).

Chrome asks the app for the icon as a bitmap. androidx.browser 1.4.0's
`TrustedWebActivityService.onGetSmallIconBitmap()` produces it with
`BitmapFactory.decodeResource(getResources(), id)` (read from the bytecode with `javap -c`).
`BitmapFactory` cannot decode a vector drawable and returns null. That Chrome then uses its
own icon is inferred from the screenshot, not read from Chrome's code.

Likely fix (small, not done here): ship `ic_notification` as white-on-transparent PNGs
(mdpi to xxxhdpi) instead of a vector, or override `onGetSmallIconBitmap()` to render the
vector into a Bitmap. The PNG route needs no code. This is reasoned from source, not yet
measured: the next build should be checked on the AVD the same way.

## Finding 3: a tap opens Chrome, and why

**Measured:** the tap opened Chrome with a URL bar (08, 09). **Reasoned from source, not
measured:** the cause below, read from `coordinator/src/sw.js` in kosmos-relay and
`OpenAddressActivity.java`.

Chrome, not the app, owns the notification's tap: the coordinator's `sw.js`
`notificationclick` runs in Chrome and calls `clients.openWindow("https://<address>/?tab=detail&agent=<session>")`.
The app's Trusted Web Activity only trusts `login.kosmosplus.com`; the person's own
address becomes trusted only through the #2854 hand-off (`OpenAddressActivity`, which
needs the per-launch `HandoffNonce`). A service worker has no nonce, so the address opens
in ordinary Chrome. The design for this is posted on #4140.

## What still needs a real phone

- A real Play-installed build with asset links verified against the live
  `login.kosmosplus.com` and the person's address (the AVD run bypassed DNS and TLS).
- Push delivery over a real carrier network, with the phone asleep and the app not
  recently used (Doze and app standby decide whether FCM wakes it promptly).
- The small icon on a real launcher and lock screen after the icon fix.
- Whether a second push is shown: notification permission read as not granted after the
  run (see Finding 1), so re-check after a fresh grant.
