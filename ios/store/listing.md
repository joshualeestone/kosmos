# App Store listing text, draft (#718)

Draft only. Nothing here has been entered into App Store Connect. Every field is
checked against Apple's length limit by `ios/store/check-listing.sh`, which reads
the text between the `<!-- field -->` markers below, so edit the text there and
run it again.

**Refreshed 2026-10-17** (Mona Lisa): the name is decided and the app record exists; pushes are switched on; the
screenshots are now taken from the app itself (`ios/store/README.md`).

**Refreshed 2026-10-15 for #6262** (Mona Lisa): the app now ships as `io.kosmos.app` under KOSMOS Agent Manager,
Inc. (#6280), Kosmos runs on Windows as well as the Mac (its Windows tunnel, `engine/remote.js`
`kosmos-tunnel.exe`). The copy describes the product as it will be at launch (Josh, 09-14), **but only what the
reviewed build does**: App Review checks the listing against the binary (2.3.1). Face ID is the example. It is built
(`ios/Kosmos/BiometricAuth.swift`) but switched off (`KosmosConfig.requireBiometricUnlock = false`, with no setting), so
the copy does not mention it until it can be turned on. Every fact below was re-read on origin/main at 24e44896eb.

The facts this copy relies on, and where each came from (first read 2026-09-25):

- Kosmos+ is a paid web service, $20 a month, sold on kosmosplus.com.
- The iOS app sells nothing and shows no purchase (Josh, 2026-09-25 07:03 CDT:
  "We won't have Apple in-app purchases for Kosmos"; kosmos-relay #117).
- The app signs in at login.kosmosplus.com, then shows the person's own
  computer (a Mac or a Windows PC running Kosmos) through the relay (`ios/README.md`).
- Face ID unlock is wired but OFF, with no setting to turn it on (`ContentView.swift`, `requireBiometricUnlock`). Not
  in the copy. A Face ID setting would add to the native surface App Review looks for (4.2), so it is worth building
  before submission.
- The company name on kosmosplus.com is KOSMOS Agent Manager, Inc.
- A push is sent for three things only: an agent needs you, replied, or posted
  (kosmos-relay `coordinator/src/notify.rs:46`, at `1ff95bde6`). There is no
  "work finished" push, so the copy does not promise one. The coordinator sends
  pushes to the iPhone app since 2026-10-17 (relay main 56d980fe, per Ice Cream
  Kitty on #6262); no phone had registered yet at that report, so none has been
  seen landing.
- A new phone must be allowed on the computer before it can see the board (the Allow
  card, and `device_grants` on the coordinator).

## Why the copy never mentions price or where to buy

With no in-app purchase, the app fits App Review Guideline 3.1.3(f), a free
companion to a paid web tool, **only if the app has no purchasing inside it and
no call to action to buy outside it.** That rule covers the listing too. So the
description says what you need (a computer running Kosmos, a Kosmos+ account) and
never says what it costs, "subscribe", or a link to a pricing page. The
promotional text follows the same rule.

## Name (30 characters at most)

<!-- name -->
Kosmos: AI Agent Manager
<!-- /name -->

**Decided:** Josh, #admin 2026-10-16 05:01 CDT ("I'm cool with the extra words"), and the App Store Connect app
record was created with this name on 2026-10-17 (per Splinter on #6262, 14:24 CDT). The Home Screen label stays
"Kosmos".

## Subtitle (30 characters at most)

<!-- subtitle -->
Your AI agents, on your phone
<!-- /subtitle -->

## Promotional text (170 characters at most, can change without a new review)

<!-- promo -->
See what every agent is doing, answer the one that needs you, and hear the moment an agent replies, wherever you are.
<!-- /promo -->

## Description (4000 characters at most)

<!-- description -->
Kosmos runs a team of AI agents on your own computer. This app puts that team in your pocket.

Open it and you see your whole workforce: who is working, who is idle, and who is waiting on you. Tap an agent to read what it has done, send it a message, or answer the question it asked. Open a project to follow the conversation between your agents and reply in the room.

Know when it matters
Kosmos sends a notification when an agent needs your decision, replies to you, or posts in one of your projects. Tap it and you land on that agent, ready to answer.

Your work stays on your computer
Your agents, their conversations and their files live on your own computer. The app connects to it over an encrypted connection, and each new phone has to be approved on that computer before it can see anything.

Made for a phone
The board is laid out for one hand: large tap targets, a menu that stays out of the way, and a dark theme for late nights. If you lose signal, the app says so and reloads by itself when you are back online.

What you need
- A Mac or Windows PC running Kosmos, which is free at installkosmos.com.
- A Kosmos+ account, to reach your computer from anywhere.

Sign in with the same Kosmos+ account you use on your computer, approve the phone once, and your agents are with you.
<!-- /description -->

## Keywords (100 characters at most, commas, no spaces)

<!-- keywords -->
ai,agents,assistant,automation,workforce,team,remote,mac,windows,projects,tasks,productivity
<!-- /keywords -->

`agent manager` and `notifications` came out when the recommended name took "Agent Manager" (the name is indexed
already); `windows` and `productivity` went in. If Josh keeps `Kosmos: AI Workforce`, put `agent manager` back in
place of `workforce`.

Left out on purpose: `claude`, `chatgpt`, `gemini`, `grok`. They are other
companies' trademarks, and Guideline 2.3.7 rejects keywords that name other
apps or brands. The words in the name and subtitle are indexed already, so
repeating "kosmos" here would waste space.

## Support URL

<!-- support_url -->
https://kosmosplus.featurebase.app/help
<!-- /support_url -->

This is the Help link in the kosmosplus.com footer, and it answered 200 on
2026-09-25. It is a third-party help site (Featurebase). Apple accepts that, but
the page must show a way to contact you, which is Josh's to confirm.

## Marketing URL (optional)

<!-- marketing_url -->
https://kosmosplus.com
<!-- /marketing_url -->

## Privacy policy URL

<!-- privacy_url -->
https://installkosmos.com/privacy
<!-- /privacy_url -->

The Privacy link in the kosmosplus.com footer. Rewritten under kosmos #3869 and
live: read on 2026-09-26, it covers Kosmos+ and the iPhone app (the account's
email and phone, device approvals, the iPhone notification token, notification
records, server logs, and the processors), which matches `privacy-label.md`.

## Category

- Primary: **Productivity**
- Secondary: **Business**

## Copyright

<!-- copyright -->
2026 KOSMOS Agent Manager, Inc.
<!-- /copyright -->

## Notes for App Review (draft, rewritten 2026-10-27 for the native app, kosmos #7352; App Review reads this, customers do not)

Kosmos is a free companion to Kosmos+, a paid web service. Nothing is sold in
the app and it links to no purchase (Guideline 3.1.3(f)).

What it does: Kosmos runs AI agents on the person's own computer. The app lets
them see those agents, talk to them, and answer them from their phone.

Native screens (Guideline 4.2): sign-in (email code, then a second step);
Agents, a live list of the person's agents and what each is doing; a
conversation with any agent, with photos, files, voice dictation and emoji;
Projects, with each project's shared room; Tasks, grouped by project, and a
page per task; Settings, including account deletion (Guideline 5.1.1(v)); push
notifications that open the agent or room that asked, with Allow and Deny on a
permission question. A few deeper pages show the person's own board (on
their own computer) in an in-app view; links to any other site open in
Safari.

To review it you need two things we provide: the demo account below, and a
computer running Kosmos on that account that we keep online for the whole
review. On first sign-in the computer is asked to allow the new phone; we
approve it from our side, so nothing is needed from you beyond signing in.

Signing in: enter the demo email and press Continue. The six-digit code
arrives in the demo inbox (its login is below). For the second step, add the
setup key below to any authenticator app and enter the code it shows.

Demo account, demo inbox password and authenticator setup key: entered in App
Store Connect's sign-in fields only, never in this file (kosmos #7352 reuses
the Play review account and review computer from kosmos #4090).

Contact during review: (Josh to fill in)

Face ID: the build carries a Face ID purpose string for a lock that is built
but switched off in this version; the app never asks for Face ID.
