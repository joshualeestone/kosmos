# Plan: found-agents "Dismiss forever" -> re-show on a new candidate (kosmos#2704)

Branch: `found-dismiss-peragent-2704`  ·  off `origin/main` @ 82710962 (includes Renet's #2727 / 9d2c5e53)
Reviewer: `joshualeestone` only. Beta = merge-on-green squash. No em dashes. PR body `Addresses #2704` (non-closing).

## The bug (verified on this main)
`engine/discover.js`:
- `dismissed()` (line 130) returns `true` as long as the GLOBAL file `found-agents-dismissed.json` (`DISMISS_FILE`, line 62) merely EXISTS.
- `dismiss()` (line 136) creates that file (a timestamp only).
- The server returns `dismissed: discover.dismissed()` on `/api/found-agents` (6329), `/api/scan-agents` (6374), and `/api/scan-import` (8040).
- The web (`paintFoundBoard` 25436, `paintScanBoard` 25573, `frScanOffer`/`frImportOffer` 42126/42141) hides the whole "agents on your computer" block whenever `dismissed === true`.

Consequence: once a person presses "Dismiss forever", the flag is permanent and GLOBAL, so EVERY later-added agent (Josh's Liu Kang) is invisible forever. That is the reported trap.

## The call, and what I rejected
The card title offers two directions: "per-agent like `decline()`" OR "re-show on a new candidate". I chose **re-show on a new candidate (snapshot semantics)** and REJECTED the decline-all-current approach.

Why I rejected decline-all-current (the prior handoff's approach):
1. `found().agents` (named agents Claude has a record of) are NOT filtered by `declined()` anywhere (only `adoptable` at discover.js:680 and `scan()` via the `known` set at 1152 are). So declining a named found-agent dir would NOT hide it -- the fix would be incomplete for exactly the population the trap is about.
2. `decline()` means semantically "this folder is NOT an agent" (#1531, discover.js:67-69, and the decline/Undo button appears only on adoptable/scan rows, never on named found-agent rows). Declining a real named agent to implement "dismiss the block" overloads and corrupts that meaning.

Snapshot semantics fits the user's actual intent for a dismiss: "I've seen everything you are offering right now and want none of it -- but tell me if you find something genuinely NEW." It preserves the web contract (`dismissed===true -> hide`) with NO web change, so it does not collide with Renet's #2727 or Mona's S9a work.

## Approach (engine + a 3-line server touch; NO web change)
`engine/discover.js`:
1. `dismiss(dirs)` becomes a PURE WRITER: writes `{dismissedAt, dirs: [...unique strings...]}` to `DISMISS_FILE`. No-arg call writes `{dirs: []}` (keeps the existing `discover.test.js` `dismiss()`/`dismissed()` no-arg contract cheap -- no filesystem walk inside the writer).
2. `dismissed(currentDirs)`:
   - `DISMISS_FILE` missing (ENOENT) -> `false` (never dismissed). [preserves existing false-when-no-file tests]
   - file unreadable / invalid JSON -> `true` (the person's answer stands -- existing contract, discover.js:52-53,131-133).
   - file valid -> read snapshot `dirs` (missing/old-format -> `[]`); return `currentDirs.every(d => snapshot.includes(d))`. Any current dir NOT in the snapshot (a NEW agent) -> `false` -> the block re-shows. Empty `currentDirs` with a file present -> `true` (stays hidden).
   - Old-format file (pre-per-agent, `{dismissedAt}` only, no `dirs`) is treated as an EMPTY snapshot, so a machine already dismissed under the old code re-shows its CURRENT agents ONCE (un-traps Josh's box); a re-dismiss then snapshots properly.
3. New helper `candidateDirs(out)`: extracts the union of dirs a route's payload would SHOW -- `agents` where `already !== true`, `adoptable`, `candidates`, `importable`. De-duped.
4. New helper `currentDismissSnapshot()`: union of `candidateDirs(found())` and `candidateDirs(scan())`, each wrapped in try/catch (a snapshot must never throw). Used by the server dismiss route.
5. Export the two new helpers. `dismiss`/`dismissed`/`DISMISS_FILE` are REPURPOSED, not vestigial -- no dead code to remove.

`server.js` (3 `dismissed()` call sites + 1 dismiss route):
- 6329, 6374, 8040: `dismissed: discover.dismissed(discover.candidateDirs(out))`.
- 6382: `discover.dismiss(discover.currentDismissSnapshot())`. Route still takes no request body (the web POSTs body-less); the POST response `{ok:true, dismissed:true}` is unchanged and correct (right after dismiss, every current dir is in the snapshot).

## Regression test (engine test -- logic lives in the engine)
New `engine/discover.dismiss-peragent-2704.test.js`, sandboxed via `AGENT_WORKFORCE_DATA` temp dir:
- `dismiss(['/x/liukang','/x/mona'])` then `dismissed(['/x/liukang','/x/mona'])` === `true`.
- `dismissed(['/x/liukang','/x/mona','/x/NEW'])` === `false`  <- THE LIU KANG FIX (a new agent re-shows).
- `dismissed([])` === `true` when the file exists (empty current stays hidden).
- fresh temp (no file): `dismissed(['/x/a'])` === `false` (ENOENT -> never dismissed).
- old-format file (`{dismissedAt}` only): `dismissed(['/x/a'])` === `false` (empty snapshot re-shows); `dismissed([])` === `true`.
- corrupt/invalid JSON file: `dismissed(['/x/a'])` === `true` (answer stands).
- `candidateDirs({agents:[{dir:'/a',already:true},{dir:'/b'}],adoptable:[{dir:'/c'}],candidates:[{dir:'/d'}],importable:[{dir:'/e'}]})` === `['/b','/c','/d','/e']` (excludes `already`).

## Validation
- `node --test engine/discover.dismiss-peragent-2704.test.js` (new), `engine/discover.test.js`, `engine/discover.decline-1531.test.js` (existing dismiss assertions).
- `node --check server.js`, `node --check engine/discover.js`.
- Full suite `bash tools/run-tests.sh` (node-only; #2704 touches NO web/ so browser-checks are not in play). Background it.
- `/challenge-loop` to convergence (model-alternate). Step-7 proof. `/create-pr` from the literal worktree path.

## Weakest premise (name it, verify first)
That the web keys "hide" PURELY on `body.dismissed === true` and holds no sticky client-side dismissed flag that would defeat re-show. VERIFIED by reading: `paintFoundBoard` (25436) and `paintScanBoard` (25573) both re-fetch every poll and key on `body.dismissed`; the dismiss button handlers (26001/26036) only hide LOCALLY until the next 5s poll (`FOUND_SIG=null`), no persistent client flag; `frScanOffer`/`frImportOffer` (42126/42141) read `FR_SCAN.dismissed` fresh. Renet's #2727 added a client var `DISCOVERY_DISMISSED` that gates only his NEW trigger, not the panel render. So computing `dismissed` from a snapshot flips it to `false` on a new candidate and the block re-shows with no web change.

Also verified NO server route other than these three reads `discover.dismissed()`, and the only tests touching dismiss/dismissed (`server.test.js:12172`, `discover.test.js:34-39`, `discover.decline-1531.test.js:97`) are all preserved by the no-arg pure-writer + ENOENT-false design.

## Iteration-3 refinement (challenge-loop)
A blind review flagged two stale comments my own changes falsified (the `DISMISS_FILE` block still said "a missing file is the only not-dismissed", and the iteration-2 residual note said "both caches cold" when TCC items live only in the import cache) plus cosmetic nits, all fixed. It also raised a real test-coverage gap: the new server dismiss-route cache-branch logic (`importWarm`/`autoWarm`/fresh-`scan()`) has no test. DECIDED = DEFER, documented: the core `dismissed()` re-show/subset logic is comprehensively engine-tested (including the mixed folder+file snapshot and the Liu Kang re-show), the dismiss route is smoke-tested end-to-end by `server.test.js`'s existing dismiss test, and the `now - at < SCAN_CACHE_MS` freshness check is the identical pattern already trusted at server.js:6367 and :142, with each cache read independently try/catch-guarded, so the incremental risk is low and a bespoke server-integration re-show test (seeding a found-agent fixture + warming the import cache against the shared harness) is disproportionate churn. Same class as #2702/#2709's deferred CLI-harness tests. If a fresh session disagrees, the test to add: in a self-contained fixture, seed a found agent (see engine/discover.test.js `seed()`), GET /api/scan-import to warm `importScanCache`, POST /api/found-agents/dismiss, assert the follow-up GET returns dismissed=true, then seed a SECOND agent and assert dismissed flips to false.

## Iteration-2 refinement (challenge-loop)
A blind review caught a deeper correctness gap: `/api/scan-import` serves `scan({importScan:true})`, a TCC-inclusive superset (~/Documents, ~/Downloads, ~/Desktop), and its `dismissed` is a subset check against the snapshot. My iteration-1 snapshot was TCC-free, so whenever any TCC-root item existed the subset check was permanently false, and since the web gates the whole scan block on one `dismissed` boolean, a legitimate dismiss silently re-showed for anyone who granted file access, worse than the old global flag. Fix: the dismiss snapshot is now built in the server route from the WARM `scanCache`/`importScanCache` (the import cache is populated by the board's own scan-import polls, so it is warm during active use, TTL 30s vs a 5s poll), which captures the TCC population without ever triggering a fresh TCC scan on a click. This also removes the back-to-back found()+scan() walks the reviewer flagged (warm caches are reused; found() is the one fresh look, one poll's cost). The engine `currentDismissSnapshot()` was removed as superseded. Residual (documented at the route): if both scan caches are cold at the instant of the click, a TCC-only item can miss the snapshot and re-show once; the next dismiss captures it.

## Iteration-1 refinement (challenge-loop)
A blind review caught that `candidateDirs` read `c.dir` for the `importable` population, but real importable rows are `looseRow`'s `{file, ...}` with NO `dir` -- so loose importable agent FILES were silently dropped, leaving the same "dismiss hides a population forever" trap live for the create import panel (whose `frImportOffer` is dismissed-gated). Fixed: importable rows contribute their `file` path as their identity, so a new loose file re-shows. The dismiss SNAPSHOT deliberately uses the TCC-free `scan()` (a dismiss must never trigger the ~/Documents-~/Downloads-~/Desktop permission prompt), so loose files that live only under TCC roots are not snapshotted -- the deliberately-invoked import panel is not suppressed by a board dismiss, which is the correct call. Test fixture corrected to the real `{file}` shape plus a new import re-show test.
