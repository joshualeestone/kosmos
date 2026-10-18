# offlineforget-6389: Remove this computer with no network keeps its key

Card: kosmos#6389. Decision comment: issuecomment-6235859657.

## Problem
`forgetNow()` wiped the state folder (the only key that can sign a retire) whatever the retire answered. Offline, the
name stayed held on the account with nothing here able to free it, and the same name could not sign in again.

## Change
- `engine/remote.js`: `retireTransient(r)` is lifted out of `clearHalfIdentity` and shared. `forget({ anyway })`:
  a transient retire failure without `anyway` keeps the folder and answers `{ ok: false, kept: true, because }`.
  Plus stays off. A final refusal, or `anyway`, wipes as before.
- `server.js` `/api/remote/forget`: reads `{ anyway: true }` (empty body is a plain Remove) and relays `kept`.
- `web/index.html`: a kept answer keeps the connected pane and shows `#plus-forget-kept` with Try again and Remove
  from this computer only; focus on Try again.
- Tests: `engine/remote.test.js` (kept, retry, anyway, refused; two older arms updated), and the
  `render-plus-panel-3829` browser check gains a `kept` mode.

## Not in scope
The relay half of the card (`recently_online`, approver ordering).

## Status
- [x] Engine, route, page, tests (remote.test.js 230/230; two mutants caught)
- [x] Static guards 165/165
- [x] Challenge loop round 1 (opus): kept path keeps the notes and tells the switch-off; route test
  (server.remote-forget-6389.test.js); the sign-in tool removes its throwaway identity from the board after a kept
  answer; Remove this computer is disabled while a Remove runs; the kept note goes when the switch is back on.
  Four mutants caught.
- [x] Challenge loop round 2 (sonnet): a damaged remote.json under a kept Remove is pinned; a docstring claim
  that Remove retries (false for a half-registered computer, whose retry is the next sign-in) is removed.
- [x] Round 3 (opus): the browser fixture is off after a kept answer, with a control that on takes the note away;
  a tool test for the kept follow-up; the kept sentence says "could not be reached or did not answer"; the page tests
  that lift paintPlus alone get a typeof guard (round 1 broke eight of them, found here).
- [x] Round 4 (sonnet): anyway from a second tab is not swallowed by a kept Remove; notes are dropped only when
  forgotten; a missing connector still says not removed yet.
- [x] Round 5 (opus): the kept reason is kept in remote.json (forget_kept) and GET /api/remote returns it, so a reload
  or another tab still says not removed yet; switching on, or a Remove that finishes, clears it; a flip pending
  before Remove is put back.
- [ ] Browser check (queued, reads the worktree at run time)
- [ ] Loop convergence, final validation, proof, PR
- HOLD: Josh 2026-10-17 11:16 (via Splinter): no new visible UI merges until his clean-up cards ship. This branch
  adds a note and two buttons, so it merges only when Splinter says.
