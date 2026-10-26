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
- `#acct-add-dialog .btn` is 44px on touch screens (the dialog now reaches phones from any page).

## Rejected
- Fetching `/api/accounts` on press to confirm the row: it live-checks every account, so the dialog would wait seconds.
- Keeping the ring for the fallback: the fallback is the no-row case, so there is nothing to ring.

## Weakest premise
That a folder AI Models listed at the last notice recompute (at most five minutes ago) still holds. The page's own
loaded list closes that window when it has one; otherwise a row removed in the last minutes could get a Sign in again.

## Checks
- render-refreshlogin-5407.js (rewritten): D1 over the board (Settings shut, closing leaves the board), D2 on an agent's
  page, K1 one-screen on a project, C2 no folder opens AI Models and no dialog, C3 a folder the page no longer lists
  opens AI Models, P1 phone 44px buttons and no sideways scroll, rows R1/R2/R3/C1/N2 on AI Models opened directly.
  Mutations, each red: the page guard removed (C3); the in-place branch removed (D1).
- engine/loginexpiry-snapshot-3532.test.js: a folder with no row names nothing.
- mobile-shots.js: `settings-accounts-landed` replaced by `login-notice-signin-dialog`; the #6206 control example moved.
