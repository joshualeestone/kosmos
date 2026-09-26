# iOS App Store listing assets (#718)

Files and drafts only. **Nothing here has been uploaded to App Store Connect**,
and no app record has been created.

## 🛑 For Josh: decide or sign before the first submission

These are listed roughly in the order they would stop a submission.

1. **Account deletion (App Review 5.1.1(v), will be rejected as things stand; filed as kosmos #3868, a blocker for both stores).**
   The sign-in page inside the app offers "No account yet? Create one", and
   there is no way to delete an account from the app or the website. Behind
   the scenes the only route is an operator script, `tools/reset-account.sh` in
   kosmos-relay, which also leaves some rows behind. Apple requires in-app deletion from any app
   that lets people create an account. **Decide:** build self-service account
   deletion before submitting, or hide "Create one" inside the app. Hiding it is
   a weaker defence, because App Review may still expect deletion from an app
   with sign-in. The privacy page now says to email hello@installkosmos.com to
   have an account deleted. That is a real route, but Apple asks for deletion
   to start inside the app, so an email address alone is not expected to pass.
2. **The App Privacy answers** in `privacy-label.md` are yours to submit. Six
   items are marked UNSURE there. The one that most needs a ruling is whether
   to declare Purchase History (my reading is no).
3. **Approve and Deny on a notification do nothing yet (kosmos #3870).** The
   buttons are registered, but tapping one only writes a log line
   (`ios/Kosmos/PushNotificationManager.swift`, the `TODO(#718)`). A reviewer
   who taps one would see nothing happen. The plan is to hide them for the
   first submission (#3870, being built next), so the listing and review notes
   do not mention them.
4. **Pushes to the iPhone app are not switched on yet** (the coordinator only
   logs them). The description and one screenshot show a notification landing,
   so pushes have to be live before submission. The app's `aps-environment` is
   also still `development` (`ios/Kosmos.entitlements`), and a store build
   needs `production`.
5. **App Review needs a way in.** That means a demo Kosmos+ account and a Mac
   running Kosmos that stays online through the review, which has to approve
   the reviewer's phone. Who runs that Mac, and a contact name for the review,
   go in the review notes in `listing.md`.
6. **Guideline 4.2 (a repackaged website) is the other likely rejection.** Face
   ID unlock is built but switched off (`requireBiometricUnlock = false`). The
   native surface a reviewer sees today is push, the offline page, pull to
   refresh and opening outside links in Safari. Turning Face ID on, and making
   Approve and Deny work, would both strengthen the case.
7. **Copy choices:** the name (`Kosmos: AI Workforce`, with two fallbacks in
   case it is taken, which only App Store Connect can tell you), the subtitle,
   the keywords and the category (Productivity, then Business). All are
   reversible until submission.
8. **The support URL** is the Featurebase help site from the kosmosplus.com
   footer. Apple wants a way to contact you on that page. Please confirm it has
   one.
9. **Which screenshot set to upload,** light or dark. Both are here, and my
   pick is below.

Resolved since the first draft: **the privacy policy** (kosmos #3869). The
page at installkosmos.com/privacy now covers Kosmos+ and the iPhone app: the
account's email and phone, device approvals, the iPhone notification token,
notification records, server logs, and Resend, Twilio and Apple as processors
(read live on 2026-09-26). Its address can go in the listing as it stands.

## What is here

| File | What it is |
|---|---|
| `listing.md` | Name, subtitle, promotional text, description, keywords, support, marketing and privacy URLs, category, copyright, and draft notes for App Review |
| `privacy-label.md` | The App Privacy answers, from reading the app and the coordinator, with sources and the UNSURE items |
| `screenshots/light/`, `screenshots/dark/` | Two screenshot sets at the 6.9-inch iPhone size |
| `check-listing.sh` | Checks every field against Apple's length limits (keywords in bytes), that each URL is https, that there are no em dashes, and that each screenshot is 1320x2868 with no alpha channel. Ends with `VERDICT:` |

## Screenshots

Four screenshots per set, at the 6.9-inch iPhone size App Store Connect asks for
(1320x2868, no transparency). An iPhone-only app needs only this size; Apple
scales it down for smaller iPhones. In upload order:

| # | File | What it shows |
|---|---|---|
| 1 | `01-home.png` | The whole team at a glance: who is working, who is idle, and the one agent that needs you |
| 2 | `02-push-landing.png` | Where a notification tap lands: Cleo's question about the printer quote, ready to answer |
| 3 | `03-agent-chat.png` | A direct conversation with Ada about the catalogue |
| 4 | `04-project-room.png` | A project room: the agents on the spring catalogue talking to each other |

**How they were made.** `ios/store/shoot.sh` runs the shared phone screenshot
tool (`docs/browser-checks/mobile-shots.js --data store`) against a throwaway
board filled with an invented team. No real account, agent, message or Mac
appears, and the tool's leak guard stops the run if one does. The rendering
engine is WebKit, the engine inside the iPhone app, but it is not the iPhone
app itself, so these show the app's content rather than a photographed phone.

Two things are set so the pictures show a Mac that is set up, which the empty
test board is not: each invented agent has a launch file and its own folder,
and the board's "Claude subscription" status reads connected. The sandbox has
no Claude account on purpose (so nobody's real account can leak into a
picture), and without this every screen would carry a "cannot reach a Claude
subscription" warning that a customer with a working Mac never sees.

**My pick: the light set.** It matches the App Store's own default look and the
kosmosplus.com site. The dark set is there if you prefer it.

To re-take them: pass the fleet heavy-run gate, then run
`NODE_PATH=$HOME/work/pw-runtime/node_modules ios/store/shoot.sh`, then
`ios/store/check-listing.sh`. Both end with a `VERDICT:` line.
