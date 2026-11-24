# kosmos#8959 slice B1c: passkeys and sign-ins from new places on the native Kosmos+ account screen

Model: the web account page (kosmos-relay signin.html loadPasskeys/renderPasskeys/removePasskey/passkey-add,
loadNewPlaces/renderNewPlaces/notMe) and its words. Routes measured in passkey.rs and second.rs (origin/main 2026-11-24).

## What it does
- **Passkeys** (hidden when Kosmos+ answers 404, passkeys off): each passkey with its added and last-used dates, Remove,
  and Add a passkey.
  - Remove asks first, naming the passkey and its date, and says that a copy saved on this iPhone is deleted in the
    Passwords app (Settings > Passwords before iOS 18).
  - Add runs register/begin, then Apple's sheet (PasskeyMaker: user verification required, attestation none,
    excludedCredentials from iOS 17.4), then register/finish named "iPhone".
- **Sign-ins from new places** (shown only with a row): each with when, and Not me, which asks first and signs the
  account out everywhere. A 401 says this iPhone's sign-in had already ended and nobody was signed out.
- AccountSecurityLogic.swift holds every rule and word the screen uses; the view only sequences requests.

## Decisions (from 8 review rounds; the per-round ledger is in the proof)
- **Same account across a renewal:** B1b's confirm renews the session (old -> fresh). B1c records it and follows the
  chain (AccountSecurity.follow, at most 8 hops), so a renewal is never read as a sign-in change. Later requests use the
  session held now.
- **Pinned to the sign-in that opened them:** the Remove and Not me dialogs. Busy flags belong to the sign-in that set
  them. A failed read's note is kept apart from an Add or Remove's own note.
- **The held challenge:** kept from begin, with its true age counted from the ask, and reused for 240 s by the next
  Add. It is let go only once finish is sent. Apple's sheet closes 15 s before Kosmos+'s 5-minute challenge lapses.
- **After a passkey is made, any refusal says to delete it** in the Passwords app.
- **Step-up:** the usual sentence becomes the page's words. Any other sentence with that code (the review account's,
  for one) is said as Kosmos+ wrote it.
- **Before iOS 17.4, an account with passkeys is not offered Add:** the exclude list cannot be passed, and an existing
  passkey could be replaced. The note sends the person to Safari or a computer. This is checked before begin when the
  list is shown, and after begin otherwise.
- **The passkey's host must match this Kosmos+'s;** otherwise the page's own words are shown.
- **An Add whose begin answers after the screen went away opens no sheet.**
- **The page-words check reads kosmos-relay's origin/main through git by default.** CI sets KOSMOS_RELAY empty to skip
  it, and says it skipped.

## Rejected
- The page's two-press "Press it again": on a phone, a dialog with a named button is the second press.
- Offering Add before iOS 17.4 with passkeys present (see above).

Weakest premise: that iCloud Keychain would replace a same-account passkey made without the exclude list before
iOS 17.4. This was not measured on a device, so the rule errs toward not offering Add.

## Tests and checks
- ios/LogicTests/run-accountsecurity.sh: 112 checks (93 with the page skipped), with mutants caught for the CBOR walk,
  the Not me body, the renewal hop bound and more.
- AccountScreenUITests: 3 of 3 in light and in dark on the final head 7763fc3767. The dark shots were read: the
  Remove dialog, the Not me dialog, and the Added note.
- Full validation on 7763fc3767: node 30,358 passed, 0 failed; shell part 4 of 4 shards.
