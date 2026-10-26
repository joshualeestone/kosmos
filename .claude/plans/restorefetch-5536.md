# restorefetch-5536: the restore's files through read grants (kosmos#5536 slice 2)

Announced on #5536 (comment 6404447686) before building. Slice 1 (engine/restorerun.js, kosmos #7138) restores one
snapshot through an injected fetchObject; this slice gives it the real one over the #5686 c read grants (relay #594).

## The call
- `engine/restorefetch.js` `readGrantFetcher({ grant, org, member, epoch, manifest, fetch?, now?, sleep? })` returns
  `{ fetchObject, plan, planned }`. The grant is injected, so the authoriser stays out of it: a reviewer's session
  now, the destination's released restore request later (#5536 r4).
- runRestore gains optional `plan` and `planned`: it hands `plan` every chunk key in the order backuprestore fetches
  them (file by file), and passes the fetcher's reasons through as `fetchProblems`.
- Batches of 500 because the route allows 40 calls an hour; the first is granted by the plan, so a refusal stops the
  restore before any file; a short grant is topped up with the next keys still to fetch.
- Expiry is kept on this computer's clock (5 minutes from when the grant was asked for); S3's own expired answer is
  the backstop, and twice on arrival stops the fetcher with a sentence about the clocks.
- Every answer must echo the request and name exactly the keys asked for; links must be https on the manifest link's
  own host, a path ending in the key, never an IP literal or localhost; no redirect; no body past maxBytes. The
  bytes are then verified against the device-signed manifest, as before.
- Budgets inside restorerun's 2-minute cut per fetch: a chunk is at most two grants (15 s), two GETs (40 s) and one
  2 s wait, 112 s; the manifest (up to 64 MB) gets one GET of 78 s after up to two grants, 110 s.
- A refusal stops; a grant not reached is tried again (3 misses in a row stop it); a GET the store did not answer
  is tried once more; a 404 is not.
- Results: a stopped restore is `ok: false` (with `partial: true` when files came back) and keeps its result;
  nothing restored is never `ok: true`.

## Review rounds (blind, one fresh reviewer each)
1. BLOCKER: clock 270 s fast made every URL stale on arrival. WARNINGs: fetch order, a dropped grant read as a
   refusal, links to any host, timeouts, a stopped restore reporting ok. All fixed.
2. BLOCKER: a grant that never answered hung the restore. WARNINGs: misses counted over the whole restore, the
   hourly-limit copy said try again, partial reported ok. All fixed.
3. WARNINGs: a reused chunk spent a call alone; one 503 lost a file silently. Fixed; one NIT declined (keeping a
   grant that answers after its cut-off).
4. WARNINGs: the manifest shared a chunk's 40 s; nothing restored still ok. Fixed.
5. WARNINGs: the manifest's outage unnamed; the route's 15-minute release window. Fixed and documented.
6. No BLOCKER, no WARNING. Four NITs taken (a missing chunk named, 10 s of manifest margin, re-grant skips fresh keys,
   a malformed epoch's own sentence); the capped failure list stated.

## Rejected
- Pinning the store host to `*.amazonaws.com`: the coordinator's endpoint is configurable (test stores, S3-compatible
  services). Same-origin plus key-in-path plus no IP literal is the line.
- Waiting out a 429 inside the fetch: restorerun cuts each fetch at 2 minutes, and the cap is per hour.
- A per-key grant: 40 calls an hour.

## Residuals, stated
- A large restore cannot resume after the hourly limit or a lapsed release; a retry starts again. Resuming (skip what
  the sink holds) belongs with the 'Restored' world, the next slice.
- Through a reviewer's session, a restore longer than the release's 15 minutes is refused part way; the caller must
  say the release lapsed.
- Chunks under another key epoch (after a rotation inside the week) are refused by name: #7156 (Baron, option a).
- The manifest URL's own host is the coordinator's word; a breached coordinator can point GETs at any https name it
  controls, learning this computer's address. The bytes are still refused by hash.

## Weakest premise
That r4's destination grant answers in the same shape as the reviewer route. If not, only the grant adapter changes.
