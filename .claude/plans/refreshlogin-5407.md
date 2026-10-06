# #5407: Refresh login on the login-expiry notice; AI Models marks the logins that need signing in again

## The ask (Josh, #admin, 2026-10-06 11:19 and 11:20)
- A "Refresh login" button on the floating login-expiry notice that opens Settings > AI Models at that account's row;
  on the ended versions too; finger size on phones.
- In AI Models: an account whose login expires within the notice's window gets a warning state, a short line
  ("Expires in 2 days: sign in again to keep its agents running"), and Sign in again as the row's main action.
  Arriving from the notice highlights the row. Logins outside the window keep the green "good until".

## Change
- engine/loginexpiry.js: `daysLeftOf` / `daysLeftInWindow`, the one count the notice and the row share.
- engine/status.js: each advisory carries `dir`, the account's folder as accounts.list names its row (unset: ~/.claude).
- server.js: a Claude row carries `loginExpiresInDays` + `loginExpiresAt` inside the window, from the login date alone
  (over any badge but rejected or signed out), or `loginEnded` past it unless `loginStopsAt` (#5168) applies.
- web/index.html:
  - the notice's gold Refresh login (all three versions), `loginAdvGo` / `acctLand`: opens AI Models in either layout,
    rings the row for 20 s (kept across the list's repaints, then taken off by a timer), focuses its Sign in again;
  - a row inside the window: amber edge, "Signed in until <date>", Josh's line, Sign in again first and gold, the line
    as its aria-describedby; an ended row: the Issue red, "Login expired", "Sign in again to bring its agents back.";
    a stops-working row (#5168) leads with Sign in again too;
  - on AI Models a notice steps aside only when its own row carries the warning (`loginAdvSyncCovered`);
  - 44px on touch screens.
- Checks: render-refreshlogin-5407 (wired in gated.txt, README, SITE_COUNTS), a design-shot screen pair in
  mobile-shots.js, server.claudelogin-3997, loginexpiry tests, web.reauth-1492 restated (the button moves, never hides).

## Design
Mona Lisa approved 11:5x with one change (ended in the Issue red), taken, plus her two copy changes and the gap.
Not taken: the badge's right alignment on a phone, which every row shares (#2649); she agreed.

## Decided
- A login notice steps aside on AI Models only when its row says the same thing, so a login is never left unwarned.
- A symlinked or out-of-home config folder lands with nothing ringed (fails safe; its notice stays).
- The notice's cached count and the row's live count can differ by one near a day boundary for a while.

## Reviews
- Review 1 (opus, blind): BLOCKER the window hung off loginOk, so an account whose agents were working got nothing;
  BLOCKER the one-screen layout was unchecked; WARNING an ended-and-stopped login showed nothing. All fixed; also the
  ring timer, focus, aria-describedby, no gold for a merely-landed row.
- Review 2 (sonnet, blind): WARNING hiding every notice on AI Models could leave a login unwarned. Fixed (per row).
- Review 3 (opus, blind): two WARNINGs, rules the check claimed but did not pin (the other paint order; the ring
  across a follow-up repaint). Pinned, each red when removed.
- Review 4: see the proof.

## Weakest premise
That the account row's folder and the advisory's folder are spelled the same. They are for the default and for every
folder Kosmos makes; a hand-set folder elsewhere lands with nothing ringed, and its notice stays up.
