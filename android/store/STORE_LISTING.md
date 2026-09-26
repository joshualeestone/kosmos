# Google Play store listing draft

## Josh must decide before upload

1. **App name:** approve `Kosmos` or choose `Kosmos+`. This draft uses `Kosmos` because the installed product is Kosmos and Kosmos+ is the remote-access service.
2. **Privacy policy URL:** provide the public HTTPS URL to enter in Play Console. Google requires one even for apps that collect no data.
3. **Account deletion:** decide and implement the public deletion-request URL and the in-app deletion path before release. The current coordinator has no account-deletion route. Google requires both when an app lets people create accounts.
4. **Data sharing:** confirm whether Resend, Twilio, Stripe, Cloudflare, Anthropic, and push providers are contractually acting only as service providers. This determines whether their transfers are exempt from Play's “shared” label.
5. **Retention and deletion:** approve a retention schedule. Coordinator notifications currently have no retention limit, and the code does not expose complete account deletion.
6. **Optional versus required data:** confirm the production second-factor policy. Email is required. Phone number is collected when SMS second-factor enrolment is used; an authenticator factor can avoid it when that option is available.
7. **Security review:** confirm that all collected data is encrypted in transit and whether users may request deletion of all collected data. The implementation uses HTTPS/TLS, but the Play answers are an owner attestation.
8. **Store category:** approve `Productivity`.

No asset has been uploaded to Google Play.

## Listing copy

**App name (30-character limit):** Kosmos

**Short description (58 of 80 characters):**

> Run and reach your Kosmos AI team securely from your phone

**Full description:**

Kosmos puts your AI team within reach wherever you are.

See every agent at a glance, open an agent’s workspace, follow active work, and respond when your team needs a decision. Project rooms keep people and agents together around the work, while notifications help you catch the moments that need your attention.

Kosmos for Android connects to the Kosmos board running on your computer through Kosmos+. Your work remains on your computer. Remote connections are encrypted, and a new device must be approved before it can reach the board.

Use Kosmos to:

- See which agents are working, waiting, or need you
- Open an agent and continue the conversation from your phone
- Follow projects and shared rooms
- Receive important notifications from your team
- Approve each new device before it gains access

A Kosmos installation and Kosmos+ account are required.

## Graphic assets

| Play field | File | Details |
| --- | --- | --- |
| App icon | `app-icon-512.png` | 512 × 512, 32-bit PNG, under 1 MB |
| Feature graphic | `feature-graphic-1024x500.png` | 1024 × 500, 24-bit PNG, no alpha |
| Phone screenshot 1 | `phone/01-team-overview.png` | 1080 × 2160 portrait |
| Phone screenshot 2 | `phone/02-agent-needs-you.png` | 1080 × 2160 portrait |
| Phone screenshot 3 | `phone/03-agent-workspace.png` | 1080 × 2160 portrait |
| Phone screenshot 4 | `phone/04-kosmos-plus.png` | 1080 × 2160 portrait |

The phone images are captured from the real board UI at a 412 × 915 CSS-pixel viewport using an isolated, invented demo fleet. No real account, agent, message, token, key, project, or machine data is present. Each raw capture is center-cropped to a 1:2 frame and scaled to 1080 × 2160. This satisfies Google's current phone screenshot rules: PNG or JPEG, each edge from 320 to 3840 pixels, and the long edge no more than twice the short edge. Four screenshots also meet Google's recommendation eligibility count and 1080-pixel minimum.

Suggested alt text, each under 140 characters:

1. `Kosmos team overview showing demo agents working, ready, and asking for a decision.`
2. `A demo agent in Kosmos asking for approval, with its status and controls visible.`
3. `A demo agent workspace showing current work and a message field.`
4. `Kosmos+ settings for secure remote access and approved devices.`

## Draft Data safety answers

These answers cover the Android TWA and the Kosmos-controlled web experience it opens. Play defines data sent from a developer-controlled WebView or equivalent web experience as collection. The TWA shell itself adds no analytics SDK and requests only internet and notification permissions, but the coordinator and board still determine the declaration.

### Overview

| Question | Draft answer | Basis or uncertainty |
| --- | --- | --- |
| Does the app collect or share required user data types? | **Yes, collects data** | The sign-in and remote-access service receives account and device data. |
| Is all collected user data encrypted in transit? | **Yes, subject to Josh confirmation** | App traffic uses HTTPS/TLS. Josh must attest that every production transfer and provider path qualifies. |
| Can users request deletion? | **No today** | No complete account-deletion route or public deletion URL was found. Must be resolved before release. |
| Does the app share user data? | **Uncertain, owner decision required** | Transfers to service providers are exempt from Play's “sharing” definition only when contracts and use meet Google's service-provider exception. |

### Data types to declare as collected

| Play data type | Required or optional | Purpose | Notes |
| --- | --- | --- | --- |
| Personal info: email address | Required | App functionality, account management, authentication, security, developer communications | Account identity and emailed sign-in codes. Deferred “needs you” email may also use it when enabled. |
| Personal info: name | Optional | App functionality, account management | The user may claim an account/display name. |
| Personal info: phone number | Optional or required depending on production second-factor policy | Authentication, security, account management | Collected for SMS second factor. Confirm whether authenticator-only enrolment is offered to every user. |
| App activity: app interactions | Required | App functionality, security | Device approvals, notification acknowledgements, sign-in and remote-board actions. Confirm whether Play expects detailed board interactions here. |
| App info and performance: crash logs | **Do not select unless production logging captures them** | Diagnostics | No Android crash or analytics SDK is present. Server logs require a production review. |
| App info and performance: diagnostics | **Uncertain** | App functionality, security, diagnostics | Coordinator access and abuse-control logs may include request metadata. Confirm production logging and retention. |
| Device or other IDs | Required | App functionality, account management, security, fraud prevention | Device IDs, install IDs, public keys, push subscription endpoints, and notification tokens are stored. |
| Messages: other in-app messages | **Uncertain** | App functionality | Direct messages and project-room content live on the user's Mac and pass through the encrypted remote connection. Confirm whether the coordinator can read content and whether Play treats the transmission as collection. |
| Files and docs | **Uncertain** | App functionality | Attachments can be used from the board. Confirm whether remote transport is end-to-end encrypted from phone to Mac and unreadable to the relay, which can remove it from Play's collection scope. |
| Financial info: purchase history | Optional | Account management | Stripe customer/subscription state is associated with the account. Card details are handled on Stripe-hosted pages and were not found in Kosmos storage. Confirm provider and form treatment. |

### Data usage details

For every selected type above, draft the following unless the uncertainty note changes it:

- **Collected:** Yes.
- **Ephemeral:** No for account, device, subscription, and notification records. Evaluate transient relayed board content separately.
- **Required:** As stated per row.
- **Purposes:** App functionality, account management, and security/fraud prevention. Add developer communications for email only. Add diagnostics only for data actually retained in production logs.
- **Shared:** No only if every recipient is a qualifying service provider processing under the developer's instructions. Otherwise select Yes and name the applicable purpose.

### Known recipients that need contract classification

- Resend for sign-in and notification email.
- Twilio Verify for SMS second-factor delivery and verification.
- Stripe for checkout, billing portal, and subscription state.
- Web Push browser/push infrastructure for Android notification delivery.
- Cloudflare or the production DNS/relay edge, depending on deployed topology and what metadata it processes.
- Anthropic for setup-assistant chat, if that flow is reachable from this app and prompt content is transmitted.

### Security and policy follow-ups

- Publish a privacy policy that matches the final answers and link it in Play Console and in the app.
- Add an in-app account-deletion path and a public web deletion-request URL before release.
- Define and enforce retention for coordinator notifications, access/security logs, sign-in records, devices, and expired credentials.
- Re-audit the live coordinator configuration, not only source defaults, before submission.
- Recheck all SDKs and web providers at release time because the Data safety form covers third-party code and services too.
- Supply Play review credentials or a review path because the app is gated by sign-in.

## Sources checked on 2026-09-25

- Google Play Console Help, “Add preview assets to showcase your app”: https://support.google.com/googleplay/android-developer/answer/9866151
- Google Play Console Help, “Provide information for Google Play's Data safety section”: https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play Console Help, “Understanding Google Play's app account deletion requirements”: https://support.google.com/googleplay/android-developer/answer/13327111
- Kosmos Android manifest and TWA configuration in this repository.
- Kosmos coordinator schema and routes in the companion `kosmos-relay` repository at local `main` on 2026-09-25.
