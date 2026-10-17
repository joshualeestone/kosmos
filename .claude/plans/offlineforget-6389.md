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
- [ ] Browser check (queued)
- [ ] Challenge loop
- [ ] Final validation, proof, PR
