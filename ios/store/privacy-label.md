# App Privacy ("nutrition label") answers, draft (#718)

Draft only. Nothing has been entered into App Store Connect.

**What this is based on.** These answers come from reading the code, not from
the policy page. The sources were `ios/Kosmos/*.swift` in this repo at `9dec76140`,
the board's `web/index.html`, and kosmos-relay `origin/main` at `1ff95bde6`
(the coordinator, sign-in page, relay and deploy files). All were read on
2026-09-25. Every "yes" below cites where the data is stored. Items marked
**UNSURE** need Josh's ruling, or a check that the code alone cannot give.

**Apple's test.** Data is "collected" when it leaves the phone in a way that
lets us or a partner get at it for longer than it takes to answer the request.
Data sent to the person's own Mac over the end-to-end encrypted relay is **not**
collected. The relay passes the encrypted bytes through and holds no
certificate for any customer's name (kosmos-relay
`crates/relay/src/serve.rs:1-13`). This includes messages, files, photos and
agent conversations.

## The short answer

| Question in App Store Connect | Answer |
|---|---|
| Do you or your partners collect data from this app? | **Yes** |
| Is any of it used to track people (across other companies' apps or sites)? | **No** |
| Third-party SDKs in the app | **None** (the app imports only Apple frameworks) |
| Advertising identifier (IDFA), App Tracking Transparency | **Not used** |

## Data types to declare

For every row: **linked to the person's identity: yes**, **used for tracking: no**.

| Apple data type | What it is here | Purpose to tick | Where it is kept |
|---|---|---|---|
| Contact Info > **Email Address** | The Kosmos+ sign-in identity; sign-in codes are emailed to it through Resend | App Functionality | `accounts.email` (kosmos-relay `coordinator/src/db.rs:179`); Resend receives it (`delivery.rs:381-436`) |
| Contact Info > **Phone Number** | Only if the person picks text-message two-factor sign-in (an authenticator app is the alternative); sent to Twilio Verify | App Functionality | `accounts.phone` (`db.rs:78,184`); Twilio (`second.rs:171-200`) |
| Identifiers > **User ID** | The account id, and the name in the person's `<name>.kosmosplus.com` address | App Functionality | `accounts` (`db.rs:98`) |
| Identifiers > **Device ID** | A random id the sign-in page makes for each phone or browser, used to approve devices. The APNs push token and bundle id are stored with it | App Functionality | `devices` (`db.rs:213-221`), `apns_tokens` (`db.rs:307-314`) |
| User Content > **Other User Content** | The names of agents and projects, carried in notification events and push text (e.g. "Leo needs you on Spring catalogue"). No message text is included | App Functionality | `notifications` (`db.rs:270-283`); payload shape `apns.rs:228-250` |

## Not collected (and why), so the reviewer's questions have answers

- **Messages, photos, videos, files, audio.** The camera and microphone
  permissions are there so a photo or video taken in the app can be sent to an
  agent; it goes to the person's own Mac, end to end encrypted (see above). The
  Photos permission only lets the app save an image the person chooses into
  their own Photos; nothing is read from the library or sent anywhere
  (`NSPhotoLibraryAddUsageDescription` in the Xcode project).
- **Location.** None. The relay and web server logs keep IP addresses (see
  UNSURE 3), but nothing turns them into a location.
- **Contacts, health, fitness, financial info, browsing history, search history,
  sensitive info.** None found.
- **Purchases.** Nothing can be bought in the app (`CAN_BUY_HERE` is false,
  kosmos-relay `signin.html:930-969`). Stripe is used on the website only.
- **Diagnostics (crash data, performance).** There is no crash reporter or
  analytics SDK. The app's `NSLog` lines stay in the phone's own log.
- **Face ID.** Checked on the phone by iOS; the app only learns yes or no
  (`BiometricAuth.swift`).
- **Usage data, product interaction, advertising.** None. No analytics exist in the app,
  the sign-in page, the board or the coordinator (searched for Plausible,
  PostHog, Google Analytics, Sentry, Mixpanel, Segment, Amplitude, Hotjar and
  Datadog).

## UNSURE: Josh to rule, or someone to check

1. **Purchase history.** The coordinator keeps a Stripe customer id and the
   account's billing standing (`db.rs:108,187`). The purchase happens on the
   website, not in the app. My reading: Apple's label covers what the app
   collects, so this is not declared. It is safe to declare it anyway
   (Purchases > Purchase History, App Functionality) if Josh prefers to
   over-declare.
2. **The APNs push token as "Device ID".** Apple has no separate row for push
   tokens. Declaring it under Device ID is the common, cautious reading.
3. **IP addresses and user agents in server logs.** The coordinator's request
   log keeps the client IP (`access_log.rs:45-97`). The relay logs the IP and
   host of each connection (`serve.rs:432-441`). Caddy's access logs on
   login.kosmosplus.com very likely keep the IP and user agent too, but that is
   Caddy's default behaviour, not something the repo states. Apple has no IP
   category. Most apps leave this undeclared unless the IP is turned into a
   location, and nothing here does that. How long journald keeps logs is set on
   the host and is not in the repo.
4. **How long data is kept.** The label does not ask this, but the privacy
   policy should say it. Accounts, devices and Macs are kept until deleted.
   The notification event table has no retention at all ("stores every event
   and has no retention, so it only grows", `db.rs:125`).
5. **Federated projects.** When projects are shared between two accounts, the
   project name and description are stored on the coordinator
   (`federation_invites`, `db.rs:330-343`). The reviewer could not confirm that
   federated room messages are encrypted end to end
   (`crates/tunnel/src/fedroom.rs`). If they are readable on the server, "Other
   User Content" already covers them, but the privacy policy's wording would
   have to change.
6. **Privacy manifest.** `ios/` has no `PrivacyInfo.xcprivacy`. The app did not
   appear to use any "required reason" API, but Xcode's privacy report on an
   archived build is the real check.

## Account deletion

The label itself asks nothing about deletion, and nothing in these answers
claims the app can delete an account. It cannot today (kosmos #3868). The live
privacy page offers deletion by email to hello@installkosmos.com, which is a
manual route, not an in-app one.

## The privacy policy

The first draft of this file listed what installkosmos.com/privacy was missing.
That was fixed under kosmos #3869: read on 2026-09-26, the page covers the
Kosmos+ account, device approvals, iPhone notification tokens, notification
records, server logs, and Resend, Twilio and Apple as processors, in line with
the table above.
