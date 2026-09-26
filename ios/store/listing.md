# App Store listing text, draft (#718)

Draft only. Nothing here has been entered into App Store Connect. Every field is
checked against Apple's length limit by `ios/store/check-listing.sh`, which reads
the text between the `<!-- field -->` markers below, so edit the text there and
run it again.

The facts this copy relies on, and where each came from (read 2026-09-25):

- Kosmos+ is a paid web service, $19.99 a month, sold on kosmosplus.com.
- The iOS app sells nothing and shows no purchase (Josh, 2026-09-25 07:03 CDT:
  "We won't have Apple in-app purchases for Kosmos"; kosmos-relay #117).
- The app signs in at login.kosmosplus.com, then shows the person's own Mac
  through the relay (`ios/README.md`).
- The company name on kosmosplus.com is KOSMOS Agent Manager, Inc.
- A push is sent for three things only: an agent needs you, replied, or posted
  (kosmos-relay `coordinator/src/notify.rs:46`, at `1ff95bde6`). There is no
  "work finished" push, so the copy does not promise one. Pushes to the iPhone
  app are not switched on yet (the coordinator only logs them until the go-live
  settings are made).
- A new phone must be allowed on the Mac before it can see the board (the Allow
  card, and `device_grants` on the coordinator).

## Why the copy never mentions price or where to buy

With no in-app purchase, the app fits App Review Guideline 3.1.3(f), a free
companion to a paid web tool, **only if the app has no purchasing inside it and
no call to action to buy outside it.** That rule covers the listing too. So the
description says what you need (a Mac running Kosmos, a Kosmos+ account) and
never says what it costs, "subscribe", or a link to a pricing page. The
promotional text follows the same rule.

## Name (30 characters at most)

<!-- name -->
Kosmos: AI Workforce
<!-- /name -->

Alternatives if the name is taken (App Store Connect only says so when the app
record is created): `Kosmos+ for iPhone`, `Kosmos Agent Manager`.

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
Kosmos runs a team of AI agents on your Mac. This app puts that team in your pocket.

Open it and you see your whole workforce: who is working, who is idle, and who is waiting on you. Tap an agent to read what it has done, send it a message, or answer the question it asked. Open a project to follow the conversation between your agents and reply in the room.

Know when it matters
Kosmos sends a notification when an agent needs your decision, replies to you, or posts in one of your projects. Tap it and you land on that agent, ready to answer.

Your work stays on your Mac
Your agents, their conversations and their files live on your own computer. The app connects to your Mac over an encrypted connection, and each new phone has to be approved on the Mac before it can see anything.

Made for a phone
The board is laid out for one hand: large tap targets, a menu that stays out of the way, and a dark theme for late nights. If you lose signal, the app says so and reloads by itself when you are back online.

What you need
- A Mac running Kosmos, which is free at installkosmos.com.
- A Kosmos+ account, to reach your Mac from anywhere.

Sign in with the same Kosmos+ account you use on your Mac, approve the phone once, and your workforce is with you.
<!-- /description -->

## Keywords (100 characters at most, commas, no spaces)

<!-- keywords -->
ai,agents,agent manager,assistant,automation,workforce,team,remote,mac,projects,tasks,notifications
<!-- /keywords -->

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

## Notes for App Review (draft; App Review reads this, customers do not)

Kosmos is a free companion to Kosmos+, a paid web service. Nothing is sold in
the app and it links to no purchase (Guideline 3.1.3(f)).

To review it you need two things we provide: a Kosmos+ demo account (below) and
a Mac running Kosmos that stays online during the review, signed in to that
account, with the review phone already approved or approvable by us.

Native features beyond the web view: push notifications through APNs that open
the agent that asked, an offline page that reloads by itself when the phone is
back online, pull to refresh, and links to other sites that open in Safari rather than in the app.

Demo account: (Josh to fill in)
Contact during review: (Josh to fill in)
