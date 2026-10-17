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
- [ ] Browser check (queued, reads the worktree at run time)
- [ ] Loop convergence, final validation, proof, PR
