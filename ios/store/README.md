# iOS App Store listing assets (#718)

Files and drafts only. **Nothing here has been uploaded to App Store Connect.** The app record exists (created by
Josh 2026-10-17, "Kosmos: AI Agent Manager", per #6262) and build 1 is in TestFlight; nothing has been submitted
for review.

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
2. **The App Privacy answers** in `privacy-label.md` are yours to submit. Five
   items are marked UNSURE there. Purchase History is declared, matching the
   Google Play draft, even though nothing is bought in the app.
3. **Approve and Deny on a notification are hidden (kosmos #3870, merged in
   #3974).** They were registered but did nothing, so the first submission
   ships without them and the listing does not mention them. The card stays
   open for a check on a real phone.
4. **Pushes to the iPhone app were switched on 2026-10-17** (relay main 56d980fe, per Ice Cream Kitty on #6262), and
   build 1's exported app was checked for a `production` `aps-environment` (Baron Draxum, #6262). The description
   says a notification lands on the agent that asked, so one should be seen landing on a real phone before
   submission; none had registered at that report.
5. **App Review needs a way in.** That means a demo Kosmos+ account and a Mac
   running Kosmos that stays online through the review, which has to approve
   the reviewer's phone. Who runs that Mac, and a contact name for the review,
   go in the review notes in `listing.md`.
6. **Guideline 4.2 (a repackaged website) is the other likely rejection.** Face
   ID unlock is built but switched off (`requireBiometricUnlock = false`). The
   native surface a reviewer sees today is push, the offline page, pull to
   refresh and opening outside links in Safari. Hiding Approve and Deny (item 3)
   removed one native feature. Turning Face ID on, and building Approve and Deny
   for real, would both strengthen the case.
7. **Copy choices:** the name is decided (`Kosmos: AI Agent Manager`, Josh
   2026-10-16). Still open: the subtitle, the keywords and the category
   (Productivity, then Business). All are reversible until submission.
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
| `screenshots/6.3-light/`, `6.3-dark/` | The required size, from the app on an iPhone 17 (1206x2622) |
| `screenshots/6.9-light/`, `6.9-dark/` | The large size, from the app on an iPhone 17 Pro Max (1320x2868) |
| `shoot-app.sh`, `shots-proxy.js` | Take all four sets from the real app in the iOS simulator (below) |
| `shoot.sh` | The older way: the board in a desktop WebKit, not the app. Kept for the board's own phone checks |
| `check-listing.sh` | Checks every field against Apple's length limits (keywords in bytes), that each URL is https, that there are no em dashes, and that each screenshot set is a size App Store Connect takes, with no alpha channel, including at least one set at the required size. Ends with `VERDICT:` |

## Screenshots

**Taken from the app itself, 2026-10-17 (#6262 step 8).** Each picture is the Kosmos iPhone app running in the
iOS simulator (iOS 27.0): its status bar, its safe areas, and the board as the app shows it through Kosmos+ (the
Kosmos+ bar, agents as a list). The September and 10-15 sets were the board drawn by a desktop WebKit at a phone
size, at the computer's own address, so they showed the at-the-computer layout, which the app never shows.

**Sizes (Apple's "Screenshot specifications" page, read 2026-10-17).** App Store Connect requires "at least one
screenshot for iPhone with Dynamic Island (medium display)": 1206x2622 or 1179x2556. The earlier sets were only
1320x2868 (the large display), which is not the required size, so they could not have been the only upload.
Both are here now:

| Set | Phone | Pixels | Needed? |
|---|---|---|---|
| `6.3-light`, `6.3-dark` | iPhone 17 | 1206x2622 | **Required** (medium display) |
| `6.9-light`, `6.9-dark` | iPhone 17 Pro Max | 1320x2868 | Optional (large display); App Store Connect uses it on the biggest phones |

Four screenshots per set, in upload order:

| # | File | What it shows |
|---|---|---|
| 1 | `01-home.png` | The team at a glance: Dana working, Cleo with a question, Eli working, Farah idle |
| 2 | `02-push-landing.png` | Where a notification tap lands: Cleo's question about the printer quote, ready to answer |
| 3 | `03-agent-chat.png` | A direct conversation with Dana, the writer, about the catalogue |
| 4 | `04-project-room.png` | A project room: the agents on the spring catalogue talking to each other |

**How they were made.** `ios/store/shoot-app.sh` builds the app with a screenshot switch (`KOSMOS_STORE_SHOTS`)
that only this script sets: it opens a given address instead of Kosmos+ and skips the notification prompt. The
address is `shots-proxy.js` in front of a throwaway board filled with an invented team
(`docs/browser-checks/mobile-shots.js --keep --data store --remote`). No real account, agent, message or computer
appears: the tool's leak guard reads the four screens first, and the proxy reads every text answer the board gives
the app with the same checks, lets a picture or file through only at the path of one the product itself ships,
and stops the run on anything else. iOS CI checks that the store build never carries the switch
(`ios/tools/check-no-shots-flag.sh`, shown able to fail). The status bar reads 9:41 with full signal, as Apple's
own pictures do.

Two things are staged so the pictures show a computer that is set up, which the empty test board is not, as the
earlier sets did: each invented agent has its own folder, and the board's "Claude subscription" status reads
connected (the sandbox has no Claude account on purpose, so nobody's real account can reach a picture).
One value is swapped rather than refused: each agent's instructions name where the `kosmos` command lives, and
the throwaway board runs from a checkout whose path holds this Mac's user name, so the proxy gives it the installed
path of a made-up user (`/Users/you/.local/share/kosmos/bin/kosmos`). No screen shows the instructions; any other
hit still stops the run.

**Worth knowing before upload.** In the chat shot your own messages carry a plain dark circle where a picture
would be, because the test board has no profile picture for you. The project room opens on its newest
post, so on the 6.3-inch phone the first message is cut at the top; the app has no way to start it higher.

**iPhone Duo.** Apple's page says: "Starting in April 2027, screenshots will be required for any app using the iOS
27.1 SDK or later" (outer display 1398x2034, inner 2007x2853; read 2026-10-17). Build 1 was made with Xcode 27.0,
so not yet. This Mac's simulators (iOS 27.0) list no Duo device, so there is no Duo set and none is guessed at.
Take one with `shoot-app.sh` (a third device) once the simulator offers it.

**My pick: the light sets** (6.3 and 6.9). They match the App Store's own default look and the kosmosplus.com
site. The dark sets are there if you prefer them.

To re-take them: `NODE_PATH=$HOME/work/pw-runtime/node_modules bash ~/.cache/claude-handoffs/queued-heavy.sh "store shots" ios/store/shoot-app.sh` (the queue holds the box for the run; run directly it checks the heavy-run
gate itself, and needs an iOS simulator runtime: `xcodebuild -downloadPlatform iOS`, about 8 GB), then
`ios/store/check-listing.sh`. Both end with a `VERDICT:` line.
