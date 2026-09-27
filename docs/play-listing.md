# Google Play Console submission packet

Preparation only. Nothing in this packet has been uploaded to Google Play, and no Play or reviewer account was created.

## Submission checklist

- [ ] Confirm the app name, short description, and full description below.
- [ ] Upload the 512 by 512 app icon and 1024 by 500 feature graphic listed below.
- [ ] Upload the two 800 by 1600 phone screenshots in filename order and paste their matching alt text.
- [ ] Complete Data safety with the answers below, then make the two owner attestations called out in that section.
- [ ] Complete the content rating questionnaire and target audience section with the answers below.
- [ ] Enter `https://installkosmos.com/privacy` as the privacy policy URL.
- [ ] Enter `https://login.kosmosplus.com/delete-account` as the account deletion URL.
- [ ] Provision reusable reviewer access, replace every bracketed reviewer placeholder below, and test it from a clean browser before submission.
- [ ] Confirm the live deletion feature flag is enabled and reconcile the privacy policy's email-only deletion wording with the self-service page.
- [ ] Do not submit until every unchecked item is complete.

## Main store listing

**App name, 6 of 30 characters**

```text
Kosmos
```

**Short description, 58 of 80 characters**

```text
Run and reach your Kosmos AI team securely from your phone
```

**Full description, 861 of 4,000 characters**

```text
Kosmos puts your AI team within reach wherever you are.

See every agent at a glance, open an agent's workspace, follow active work, and respond when your team needs a decision. Project rooms keep people and agents together around the work, while notifications help you catch the moments that need your attention.

Kosmos for Android connects to the Kosmos board running on your computer through Kosmos+. Your work remains on your computer. Remote connections are encrypted, and a new device must be approved before it can reach the board.

Use Kosmos to:

- See which agents are working, waiting, or need you
- Open an agent and continue the conversation from your phone
- Follow projects and shared rooms
- Receive important notifications from your team
- Approve each new device before it gains access

A Kosmos installation and Kosmos+ account are required.
```

The product claims above are supported by the mobile board UI in `web/index.html`, project and conversation routes in `server.js`, the device and Mac approval flow in `coordinator/src/plus.rs` and `coordinator/src/macs.rs` in the kosmos-relay repository, and encrypted relay design documented by the public privacy policy and coordinator transport code. Recheck this paragraph if those paths change before submission.

**Category:** Productivity

**Tags:** Productivity, Business, Collaboration, AI assistant

**Contains ads:** No

## Graphic assets

All paths are relative to this repository.

| Play field | File | Dimensions | SHA-256 |
| --- | --- | ---: | --- |
| App icon | `docs/play-listing/app-icon-512.png` | 512 by 512 | `ebdb8a279528f4ca496ce8e36ec194a904cb026c5f32104909b00a55f2bde124` |
| Feature graphic | `docs/play-listing/feature-graphic-1024x500.png` | 1024 by 500 | `8241672b646400f0468c7b48595e8ffdad56dcac17a66ea98cb39b667d50648c` |
| Phone screenshot 1 | `docs/play-listing/phone/01-sign-in.png` | 800 by 1600 | `1d4d0f72def45dc259bf9dd015de802301898f0ca930b950f4be1f1baea1db63` |
| Phone screenshot 2 | `docs/play-listing/phone/02-offline-retry.png` | 800 by 1600 | `b0298a786479d2da600ee7a94e116d23a169d576a366fd7744c1c1da5f517ad0` |

The phone screenshots are real API 35 Moto-profile AVD captures from version 0.1.1, versionCode 2. Their original 720 by 1600 pixels are unchanged. Forty pixels of neutral background were added to each side to meet the 2:1 Play aspect-ratio limit without cropping or stretching the interface. No account data appears.

Paste the alt text that matches each image:

1. `Kosmos+ sign-in on Android, asking for an email address to send a six-digit code.`
2. `Kosmos Android offline page with a connection message and a large Retry button.`

A board image was deliberately omitted. The handed-over AVD retained an isolated test sign-in, but its local coordinator was unavailable. The two required Play-compatible screenshots are complete without inventing a successful board state.

## Data safety

### Top-level answers

| Play question | Answer to enter | Evidence and final check |
| --- | --- | --- |
| Does the app collect or share any required user data types? | **Yes** | The coordinator stores account, device, push, notification, billing-state, and request metadata. See `coordinator/src/db.rs` and `coordinator/src/access_log.rs` in kosmos-relay. |
| Is all collected user data encrypted in transit? | **Yes** | The Android TWA default URL is HTTPS in `android/app/src/main/AndroidManifest.xml`; production ingress redirects HTTP and terminates TLS in `deploy/caddy/Caddyfile` in kosmos-relay. Owner must confirm no production exception exists. |
| Can users request deletion of their data? | **Yes** | Public URL: `https://login.kosmosplus.com/delete-account`. Implementation is in `coordinator/src/account_delete.rs`; transactional row removal is `delete_account_everything` in `coordinator/src/db.rs`. Confirm `KOSMOS_ACCOUNT_DELETION=1` in production before submission. |
| Is user data shared with third parties under Play's definition? | **No**, if the processor attestation below is true | The privacy policy names service providers. Play excludes transfers to processors acting only on the developer's instructions. Josh must confirm those contracts and uses before entering No. Select Yes for any recipient that uses the data for its own purposes. |

### Data types to select

For every row marked Collected, select **not ephemeral**. The coordinator retains the record beyond the immediate request. Sharing is No only after the processor attestation above.

| Play data type | Collected | Required | Purposes to select | Code and policy basis |
| --- | --- | --- | --- | --- |
| Personal info: Email address | Yes | Required | App functionality; Account management; Security and fraud prevention | `Account.email`, hashed email sign-in records, and notification delivery in `coordinator/src/db.rs`; sign-in routes in `coordinator/src/signin.rs`. |
| Personal info: User IDs | Yes | Required | App functionality; Account management; Security and fraud prevention | Coordinator-generated account IDs and the user-chosen Kosmos address identify an account in `coordinator/src/db.rs`. The address is an account identifier, not a person's real name. |
| Personal info: Phone number | Yes | Optional | Account management; Security and fraud prevention | SMS second-factor enrollment in `coordinator/src/second.rs` and account phone storage in `coordinator/src/db.rs`. Authenticator-based second factor can avoid it. |
| Financial info: Purchase history | Yes | Required for paid service | App functionality; Account management | Account standing and Stripe customer association in `coordinator/src/db.rs`; checkout and billing portal in `coordinator/src/stripe.rs`. Kosmos does not store card numbers. |
| App activity: App interactions | Yes | Required | App functionality; Analytics; Security and fraud prevention | Request method/path, status, Origin, and failure classification are recorded by `coordinator/src/access_log.rs`. Notification acknowledgements and device approval state are stored in `coordinator/src/db.rs`. Select Analytics only because aggregate request activity is retained for operating the service, not for ads or cross-app tracking. |
| App info and performance: Diagnostics | Yes | Required | App functionality; Analytics; Security and fraud prevention | Request latency and response status are retained by `coordinator/src/access_log.rs`; rotation is configured in `deploy/caddy/Caddyfile`. |
| Device or other IDs | Yes | Required | App functionality; Account management; Security and fraud prevention | Device IDs, install IDs, Mac public keys, web-push endpoints and keys, and notification tokens are stored by `coordinator/src/db.rs` and used by `coordinator/src/push.rs`. |
| Other user-generated content | Yes | Optional | App functionality | Notification metadata can contain agent and project/session names. `Notification` storage in `coordinator/src/db.rs` and `coordinator/src/push.rs` intentionally omit message content. |

### Data types not to select

- **Crash logs:** no Android crash, analytics, Firebase, or telemetry SDK is present. Server response errors are covered as Diagnostics, not Android crash logs.
- **Precise or approximate location:** the app does not request location permission or derive a location. Security infrastructure sees a network client key for rate limiting, but source does not derive or retain geographic location. Revisit this answer if a production edge enriches IP addresses with location.
- **Photos, videos, audio files, files and documents, emails, SMS, and other in-app messages:** board content remains on the user's computer and travels through an encrypted connection that the relay cannot read. Google's unreadable end-to-end encrypted-data exception applies. The coordinator database header in `coordinator/src/db.rs` says it never stores message content, and the public privacy policy says the relay cannot read agent conversations or files.
- **Payment information:** Stripe-hosted pages process card details; Kosmos stores the Stripe customer identifier and subscription standing, which is disclosed above as Purchase history.
- **Name, address, contacts, health and fitness, browsing history, search history, installed apps, calendar, and other financial information:** no collection was found in the Android manifest or coordinator paths audited for this packet. The user-chosen Kosmos URL label is declared as User IDs, not Name or postal Address.

### Collection notes and retention

- Account, device, grant, push, notification, federation, second-factor, and sign-in records are deleted by `delete_account_everything` in `coordinator/src/db.rs`.
- Sign-in codes are salted and hashed. Expired or consumed codes have a cleanup path in `coordinator/src/db.rs`.
- Coordinator access logs deliberately omit bodies, authorization headers, and query strings. `deploy/caddy/Caddyfile` keeps coordinator access logs for seven days and rolls login logs by size/count.
- Notification metadata records who, what, and when, never the message words. There is no time-based notification retention in the audited source; it remains until account deletion or another explicit removal. This should be stated consistently in the privacy policy.
- Android permissions are limited to Internet, network state, and notifications in `android/app/src/main/AndroidManifest.xml`. `android:allowBackup` is false.
- The desktop setup assistant can send text to Anthropic, but that flow is not exposed by this Android TWA path. Do not add it to the Android form unless the Android product later exposes that flow.

### Required owner attestations

Before submission, Josh must verify both statements and change the form answers if either is false:

1. Every production transfer to Stripe, Resend, Twilio, browser push infrastructure, hosting/DNS providers, and any other recipient is solely for processing on Kosmos's instructions and is contractually barred from using the data for its own purposes.
2. Every production path that carries a selected data type uses transport encryption, and `KOSMOS_ACCOUNT_DELETION=1` is enabled on the production coordinator.

## Content rating questionnaire

Use the **Utility, Productivity, Communication, or Other** category when IARC asks for the app category.

| Topic | Answer | Reason |
| --- | --- | --- |
| Violence or graphic content | No | No developer-supplied violent content. |
| Sexuality or nudity | No | No developer-supplied sexual content. |
| Language | No | No developer-supplied profanity. |
| Controlled substances | No | No developer-supplied drug content. |
| Gambling or simulated gambling | No | No gambling functionality. |
| Scary content | No | No developer-supplied horror content. |
| User interaction or exchange of content | **Yes** | Direct conversations and project rooms allow people and agents to exchange content. Access control does not make this answer No. |
| Shares a user's physical location with others | No | No location collection or sharing. |
| Digital purchases in the app | No | Phone sign-in hides account and billing management. Kosmos+ is obtained outside the Android app. Revisit if purchase links become reachable on Android. |
| Advertising | No | No ads or advertising SDK. |

AI agents and users can produce content that Kosmos does not pre-author. Answer any follow-up about unrestricted user-generated content truthfully. Do not infer the final age rating before IARC calculates it from the submitted answers.

## Target audience and content

- **Target age group:** Ages 18 and over only.
- **Designed for children:** No.
- **Appeals to children:** No. The product is a paid business/productivity tool for operating AI agents, team rooms, computers, and device approvals. The listing and graphics contain no child-directed characters, language, or activities.
- **Families policy:** Not applicable when only Ages 18 and over is selected.

## Privacy and account deletion

- **Privacy policy URL:** `https://installkosmos.com/privacy`
- **Account deletion URL:** `https://login.kosmosplus.com/delete-account`
- **In-app path:** Sign in, scroll below Your Macs, tap **Delete account**.

The public privacy policy currently tells users to email `hello@installkosmos.com` for deletion, while the sign-in page now offers self-service deletion. Update the policy so both paths and actual retention agree before Play submission. The self-service source is feature-flagged and refuses destructive requests unless `KOSMOS_ACCOUNT_DELETION=1`, so verify that production setting without performing a test deletion on a real account.

## App access for Play review

Select **All or some functionality is restricted**. The useful experience requires a Kosmos+ account, an approved device, and a reachable Kosmos computer.

Do not submit these notes with placeholders. A normal one-time email code is not sufficient because Play requires reusable, always-available access. Create a dedicated review account and test environment outside this preparation task, then paste:

```text
Kosmos requires sign-in and an approved test computer.

1. Open the app.
2. Enter [REVIEW EMAIL].
3. Open [REVIEW INBOX URL] and sign in with [REVIEW INBOX USERNAME] and [REVIEW INBOX PASSWORD].
4. Open the newest Kosmos sign-in email and enter its six-digit code in the app.
5. If prompted for a second factor, use [REUSABLE SECOND-FACTOR INSTRUCTIONS].
6. Tap Open my Kosmos for the pre-approved reviewer computer named [REVIEW COMPUTER NAME].

The review account and inbox are available at all times, do not depend on location, and do not expire during review. No purchase is required. For access problems contact [REVIEW CONTACT EMAIL].
```

Before submission, test those exact instructions on a clean Android device that has never used the account. Keep the test computer reachable throughout review. If an always-on computer cannot be guaranteed, build a dedicated stable reviewer environment rather than asking the reviewer to coordinate a temporary code or availability window.

## Sources checked

- Android shell and TWA: `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, and `android/app/src/main/java/io/kosmos/app/`.
- Existing approved listing work: `android/store/STORE_LISTING.md` and `android/store/`.
- Real AVD evidence: `android/evidence/vc2-4132/`.
- Coordinator storage and deletion: `coordinator/src/db.rs`, `coordinator/src/account_delete.rs`, `coordinator/src/config.rs`, and `coordinator/src/lib.rs` in kosmos-relay.
- Authentication, billing, push, and logging: `coordinator/src/signin.rs`, `coordinator/src/second.rs`, `coordinator/src/stripe.rs`, `coordinator/src/push.rs`, `coordinator/src/access_log.rs`, and `deploy/caddy/Caddyfile` in kosmos-relay.
- Public policy: `https://installkosmos.com/privacy`.
- Google Play Help: `https://support.google.com/googleplay/android-developer/answer/10787469` for Data safety, `https://support.google.com/googleplay/android-developer/answer/13327111` for account deletion, `https://support.google.com/googleplay/android-developer/answer/9866151` for preview assets, `https://support.google.com/googleplay/android-developer/answer/9898843` for content ratings, `https://support.google.com/googleplay/android-developer/answer/9867159` for target audience, and `https://support.google.com/googleplay/android-developer/answer/15748846` for app access.
