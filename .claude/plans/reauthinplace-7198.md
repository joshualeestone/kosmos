# reauthinplace-7198: Refresh login opens the Sign in again dialog in place (kosmos#7198)

Owner: Ice Cream Kitty. Josh, #admin 2026-10-26 08:32: "lets update per Kitty's plan on the ai model modal".

## Change
- web/index.html `loginAdvGo(dir, email, opener)`: a notice that names an account folder opens that account's Sign in
  again dialog (`openAcctReauth`) right where the person is, on any page; focus returns to the notice's button. A notice
  with no folder, or a folder this page's loaded account list no longer has, opens AI Models as before.
- engine/status.js `dirOf`: a notice names a folder only when its login matches that row's (as before) AND AI Models
  lists it (`accounts.list`, from disk, no live check; seam `opts.rowDirs`), so the dialog is never opened for a folder
  with no account row.
- The #5407 row landing (ring, timer, focus) is removed: with the dialog opening in place it had no path left.
- `#acct-add-dialog #acct-add` is 44px on touch screens (the dialog now reaches phones from any page; scoped to that one
  button since review 6, not every dialog button).

## Rejected
- Fetching `/api/accounts` on press to confirm the row: it live-checks every account, so the dialog would wait seconds.
- Keeping the ring for the fallback: the fallback is the no-row case, so there is nothing to ring.

## Weakest premise
That a folder AI Models listed at the last notice recompute (at most five minutes ago) still holds. The page's own
loaded list narrows that window when it has one (it does not close it: the list can be minutes old too), and the
dialog's start request refuses a folder the board no longer knows (server.js /api/connect/start); otherwise a row
removed in the last minutes could get a Sign in again. A signed-out folder (no account email) has no AI Models row,
so the board names none and the notice lands on AI Models, where Add a provider signs in (review 7).
The other direction fails safe: the page's list can be older than the board's (read once by a picker and not
refreshed), so an account added since is missing from it, and Refresh login then opens AI Models instead of the
dialog. Accepted: the person still lands where they can sign in.

## Challenge loop, review 1 (decided)
- The dialog's background: only the login notice slot is made inert while the account dialog is open (all four
  openers call loginAdvInert(true); closeAcctAdd calls it with false), not the whole page. Rejected the whole-page inert: the dialog opens from
  first-run, Settings and every sign-in-again path, and first-run already manages its own inert set, so a page-wide
  one here would fight it. What would change my mind: a second control outside the dialog that reopens it.
- Focus on close, off Settings (where the Accounts door is hidden), falls back to a Refresh login still showing,
  never to a hidden element (D4). Only when a notice opened the dialog; every other opener keeps its old fallback to the Accounts door (review 3).

## Challenge loop, review 2 (decided)
- The page fails open when it has not read its account list: the board's naming stands (status.js dirOf already
  requires the folder in accounts.list), and C4 now pins that the dialog opens there.
- Deferred: the rest of the page stays Tab-reachable behind the account dialog. That is how the dialog has always
  behaved, from every opener; this branch makes unreachable only the one control that would reopen it mid sign-in.
  Making the dialog fully modal is a change to every opener and belongs on its own card.
- Deferred: accounts.list on each notice recompute. It reads files only (readdir and each folder's .claude.json, no
  process), the 5-second status tick already calls it, and the notices are recomputed at most every five minutes.

## Checks
- render-refreshlogin-5407.js (rewritten): D1 over the board (Settings shut, closing leaves the board), D2 on an agent's
  page, K1 one-screen on a project, C2 no folder opens AI Models and no dialog, C3 a folder the page no longer lists
  opens AI Models, P1 phone 44px buttons and no sideways scroll, rows R1/R2/R3/C1/N2 on AI Models opened directly.
  Mutations, each red: the page guard removed (C3); the in-place branch removed (D1).
- engine/loginexpiry-snapshot-3532.test.js: a folder with no row names nothing.
- mobile-shots.js: `settings-accounts-landed` replaced by `login-notice-signin-dialog`; the #6206 control example moved.

## Challenge loop, review 6 (decided)
- An API-key row is never a Sign in again target (#2433): status.js leaves API-key rows out of rowDirs, and the
  page guard needs a non-API-key row; the engine test and C5 pin both.
- The phone sizing is scoped to the dialog's Start the sign-in (#acct-add), the one button P1 measures.

## Review 8 (opus)
- W the notices' repaint signature left out the folder, so when the board stopped naming one (its row removed from
  another device) Refresh login kept it for the notice's whole life and opened Sign in again for a folder the board
  refuses -> FIXED: the folder is in the signature; web.loginadvdir-7198.test.js runs the shipped paint (red before
  the fix, green after; an unchanged notice still does not repaint).
- N this plan's Change section still named the 44px rule as every dialog button -> corrected.
