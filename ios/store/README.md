# iOS App Store listing assets (#718)

Files and drafts only. **Nothing here has been uploaded to App Store Connect**,
and no app record has been created.

## 🛑 For Josh: decide or sign before the first submission

These are listed roughly in the order they would stop a submission.

1. **Account deletion (App Review 5.1.1(v), will be rejected as things stand; filed as kosmos #3868, a blocker for both stores).**
   The sign-in page inside the app offers "No account yet? Create one", and
   there is no way to delete an account, in the app or anywhere else. The only
   route is an operator script, `tools/reset-account.sh` in kosmos-relay, which
   also leaves some rows behind. Apple requires in-app deletion from any app
   that lets people create an account. **Decide:** build self-service account
   deletion before submitting, or hide "Create one" inside the app. Hiding it is
   a weaker defence, because App Review may still expect deletion from an app
   with sign-in.
2. **The privacy policy does not cover this app.** installkosmos.com/privacy
   says "Kosmos has no account of its own". This app signs in to a Kosmos+
   account and sends the coordinator an email address, a phone number when text
   sign-in is chosen, and a push token. The policy has to be extended, or a
   Kosmos+ policy published, before its address goes in the listing. It is
   published under your name, so the wording is yours. `privacy-label.md` lists
   what it needs to cover.
3. **The App Privacy answers** in `privacy-label.md` are yours to submit. Six
   items are marked UNSURE there. The one that most needs a ruling is whether
   to declare Purchase History (my reading is no).
4. **Approve and Deny on a notification do nothing yet.** The buttons are
   registered, but tapping one only writes a log line
   (`ios/Kosmos/PushNotificationManager.swift`, the `TODO(#718)`). A reviewer
   who taps one will see nothing happen. Before submission they should either
   be wired up or removed. This is an engineering call, flagged here because
   it decides what the review notes can claim.
5. **Pushes to the iPhone app are not switched on yet** (the coordinator only
   logs them). The description and one screenshot show a notification landing,
   so pushes have to be live before submission. The app's `aps-environment` is
   also still `development` (`ios/Kosmos.entitlements`), and a store build
   needs `production`.
6. **App Review needs a way in.** That means a demo Kosmos+ account and a Mac
   running Kosmos that stays online through the review, which has to approve
   the reviewer's phone. Who runs that Mac, and a contact name for the review,
   go in the review notes in `listing.md`.
7. **Guideline 4.2 (a repackaged website) is the other likely rejection.** Face
   ID unlock is built but switched off (`requireBiometricUnlock = false`). The
   native surface a reviewer sees today is push, the offline page, pull to
   refresh and opening outside links in Safari. Turning Face ID on, and making
   Approve and Deny work, would both strengthen the case.
8. **Copy choices:** the name (`Kosmos: AI Workforce`, with two fallbacks in
   case it is taken, which only App Store Connect can tell you), the subtitle,
   the keywords and the category (Productivity, then Business). All are
   reversible until submission.
9. **The support URL** is the Featurebase help site from the kosmosplus.com
   footer. Apple wants a way to contact you on that page. Please confirm it has
   one.
10. **Which screenshot set to upload,** light or dark. Both are here, and my
    pick is below.

## What is here

| File | What it is |
|---|---|
| `listing.md` | Name, subtitle, promotional text, description, keywords, support, marketing and privacy URLs, category, copyright, and draft notes for App Review |
| `privacy-label.md` | The App Privacy answers, from reading the app and the coordinator, with sources and the UNSURE items |
| `screenshots/light/`, `screenshots/dark/` | Two screenshot sets at the 6.9-inch iPhone size |
| `check-listing.sh` | Checks every field against Apple's length limits (keywords in bytes), that each URL is https, that there are no em dashes, and that each screenshot is 1320x2868 with no alpha channel. Ends with `VERDICT:` |

## Screenshots

(filled in after the run)
