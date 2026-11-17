---
pre_challenge: true
method: challenge-loop
branch: ogimage-8636
diff_hash: ab86757b5296b1339dbacc6c403135a9dd5c1b59890ac03d768b066a710cebd8
validation: passed (targeted 19-file list, 597 pass 0 fail at 57e27832b7, run after the box hold lifted; NOT the full suite: the Mortals full-suite hold stands, CI runs it; surface gate #2518 run locally, passes)
subdir_audit: not run (no subdirectory CLAUDE.md changed)
timestamp: 2026-11-17T21:24:08Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** No. Stopped after iteration 8 by the fleet's standing review cap ("8 rounds unless a BLOCKER is open"; no BLOCKER open). At the code reviewer's request (Raiden, m7661) a ninth fresh blind pass re-read the whole change, including iteration 8's fixes: no BLOCKER, three WARNINGs, all fixed in 57e27832b7, and Raiden reviewed that product delta (m7665): no new findings. No further blind pass ran after that fix.
**Total findings (BLOCKER/WARNING/CONVENTION):** 1 BLOCKER, 29 WARNINGs, 1 CONVENTION, plus NITs
**Fixed:** 23 | **Deferred:** 8 (counting repeats once) | **Asked:** 0

Origin column: the per-finding blame lookup (6c-bis) was not run in this loop; every row is recorded BRANCH, the fail-safe default. Several findings were plainly about earlier fixes (iteration 5's first warning concerned iteration 4's own comment, which was then cut back, not rewritten).

Validation note: the canonical helper runs the full suite, which the Mortals hold forbids (Liu Kang m7609), so each iteration was validated with the targeted list. During Splinter's box hold (12:05 to 12:30 CST) iterations 6 to 8 ran only the touched test files, and their reviewers read without running tests; the full targeted list ran again once the hold lifted.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [BLOCKER] engine/unfurl.js — a picture over IMAGE_MAX never got a verdict, so its link got no card at all --> FIXED (0f4f4c79a0; test)
- [WARNING] warm() fetched the picture outside the picture's in-flight key (a second fetch could start) --> FIXED (0f4f4c79a0; test)
- [WARNING] a passing failure on refresh turned a good picture bad --> FIXED (0f4f4c79a0; test)
- [WARNING] a dropped or aged verdict hides the card for a poll --> DEFERRED then, partly FIXED in iteration 7 (older cards keep their words)
- [CONVENTION] no browser evidence for the page change --> DEFERRED: no new look (the card only loses a broken box); a real-board check is owed and stated on the card
- [NIT] direct route ignored a known-bad verdict --> fixed; [NIT] a redrawn card asked again for a failed picture --> fixed (LPV_FAILED)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] a cached picture with no verdict left the card withheld --> FIXED (d15f2f1117)
- [WARNING] a first passing failure meant ten minutes words-only --> FIXED (d15f2f1117: retried after a minute; test)
- [WARNING] fixed-count polling in the route test could flake on CI --> FIXED (d15f2f1117: polls to a deadline)
- [WARNING] extra fetch cost not stated --> FIXED (plan note)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] a rebuilt verdict lost its passing flag --> FIXED (cbb0c53f0b)
- [WARNING] the verdict cap could drop a verdict in use --> FIXED (cbb0c53f0b: a read moves it to the newest end; test)
- [WARNING] the direct route started a second fetch --> FIXED (cbb0c53f0b: shares the running fetch)
- [NIT] LPV_FAILED kept the oldest failures at its cap --> fixed (keeps the newest; test)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] a slow picture delays the card --> DEFERRED: bounded by the picture fetch settling; a comment added (later corrected in iteration 5)
- [WARNING] verdict and cache lifetimes hard to reason about --> DEFERRED: by design; comment added

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (recorded BRANCH; the first concerned iteration 4's comment)
- [WARNING] iteration 4's comment understated the wait (redirects) --> FIXED (bc6e42cc67: the numeric claim deleted)
- [WARNING] warm held the page's in-flight entry until the picture settled --> FIXED (bc6e42cc67; test)
- [WARNING] the picture route bypassed the shared fetch --> FIXED (bc6e42cc67; test)
- [WARNING] a DNS blip counted as a ten-minute bad --> FIXED (bc6e42cc67: passing for pictures only; test)

#### Iteration 6
**Reviewer model:** sonnet (read only, box hold)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] a wordless card with a failed picture drew an empty card --> FIXED (699f8845ac; test)
- [WARNING] passing-failure test differed between paths --> FIXED (699f8845ac: one helper)
- [WARNING] unbounded picture warm-ups and the waiting card --> DEFERRED then (duplicate in part); concurrency FIXED in iteration 7

#### Iteration 7
**Reviewer model:** opus (read only, box hold)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] picture bytes over budget evicted page previews (whole cards lost) --> FIXED (46ab1e7b31: only byte entries are evicted for the byte budget; test)
- [WARNING] no limit on concurrent picture fetches --> FIXED (46ab1e7b31: four at a time; test)
- [WARNING] a card already on screen vanished while its verdict was unknown --> FIXED (46ab1e7b31: a card first fetched over 10 s ago is carried with its words; test)
- [NIT] a dead domain is re-resolved every minute --> deferred (cheap); [NIT] comment order --> fixed

#### Iteration 8
**Reviewer model:** sonnet (read only, box hold)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs (one warning repeats the plan's cost note)
**Self-generated:** 0
- [WARNING] the picture route queued behind background warm-ups --> FIXED (fb891429ca: the route shares a running fetch but never queues; test)
- [WARNING] an unreadable fetchedAt hid a card indefinitely --> FIXED (fb891429ca: treated as past the wait)
- [NIT] resetForTests could push the running count negative --> fixed (clamped)

#### Iteration 9
**Reviewer model:** opus (read only)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (recorded BRANCH; the first concerned iteration 8's fix)
- [WARNING] the picture route still waited behind a same-address background fetch queued for a slot --> FIXED (57e27832b7: flight object; a now caller starts it; test)
- [WARNING] the 200-entry count cap could drop page previews --> FIXED (57e27832b7: a picture entry goes first; test)
- [WARNING] every read refreshed stale good verdicts for every row --> FIXED (57e27832b7: reads refresh only bad verdicts; a good one refreshes when drawn; test)
- [NIT] the direct route queued too --> fixed (now:true)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/unfurl.js | BRANCH | oversized picture: no card at all | FIXED | 0f4f4c79a0 |
| 2 | 1 | WARNING | engine/unfurl.js | BRANCH | warm fetched outside the in-flight key | FIXED | 0f4f4c79a0 |
| 3 | 1 | WARNING | engine/unfurl.js | BRANCH | passing failure turned good bad | FIXED | 0f4f4c79a0 |
| 4 | 1 | WARNING | server.js | BRANCH | lost verdict hides card | FIXED | 46ab1e7b31 (older cards) |
| 5 | 1 | CONVENTION | web/index.html | BRANCH | no browser evidence | DEFERRED | no new look; real-board check owed |
| 6 | 2 | WARNING | engine/unfurl.js | BRANCH | cached picture without verdict | FIXED | d15f2f1117 |
| 7 | 2 | WARNING | engine/unfurl.js | BRANCH | first passing failure ten minutes | FIXED | d15f2f1117 |
| 8 | 2 | WARNING | server.unfurl-image-8636.test.js | BRANCH | fixed-count polling | FIXED | d15f2f1117 |
| 9 | 2 | WARNING | plan | BRANCH | extra fetch cost unstated | FIXED | d15f2f1117 |
| 10 | 3 | WARNING | engine/unfurl.js | BRANCH | rebuilt verdict lost passing flag | FIXED | cbb0c53f0b |
| 11 | 3 | WARNING | engine/unfurl.js | BRANCH | cap could drop a verdict in use | FIXED | cbb0c53f0b |
| 12 | 3 | WARNING | server.js | BRANCH | direct route second fetch | FIXED | cbb0c53f0b |
| 13 | 4 | WARNING | server.js | BRANCH | slow picture delays card | DEFERRED | bounded by the fetch settling |
| 14 | 4 | WARNING | engine/unfurl.js | BRANCH | lifetimes hard to reason about | DEFERRED | by design, commented |
| 15 | 5 | WARNING | server.js | BRANCH | comment understated the wait | FIXED | bc6e42cc67 |
| 16 | 5 | WARNING | engine/unfurl.js | BRANCH | warm held page in flight | FIXED | bc6e42cc67 |
| 17 | 5 | WARNING | server.js | BRANCH | picture route bypassed shared fetch | FIXED | bc6e42cc67 |
| 18 | 5 | WARNING | engine/unfurl.js | BRANCH | DNS blip ten-minute bad | FIXED | bc6e42cc67 |
| 19 | 6 | WARNING | web/index.html | BRANCH | empty card for failed picture | FIXED | 699f8845ac |
| 20 | 6 | WARNING | engine/unfurl.js | BRANCH | passing test differed by path | FIXED | 699f8845ac |
| 21 | 7 | WARNING | engine/unfurl.js | BRANCH | byte eviction took page previews | FIXED | 46ab1e7b31 |
| 22 | 7 | WARNING | engine/unfurl.js | BRANCH | no concurrency cap | FIXED | 46ab1e7b31 |
| 23 | 8 | WARNING | engine/unfurl.js | BRANCH | route queued behind warm-ups | FIXED | fb891429ca |
| 24 | 8 | WARNING | server.js | BRANCH | NaN age hid card | FIXED | fb891429ca |
| 25 | 9 | WARNING | engine/unfurl.js | BRANCH | route queued behind same-address flight | FIXED | 57e27832b7 |
| 26 | 9 | WARNING | engine/unfurl.js | BRANCH | count cap dropped page previews | FIXED | 57e27832b7 |
| 27 | 9 | WARNING | server.js | BRANCH | reads refreshed good verdicts | FIXED | 57e27832b7 |

### After the loop: CI's browser-check gate (#1720)
- CI on b57f33d3c7 refused the web/ change for having no docs/browser-checks assertion. Added a real check
  (a9eca2f0dd: render-lpv-image-8636.js, registered in gated.txt and the README; docs only, no product code): a DM
  thread with a preview whose picture answers 404 keeps its words and no box, a redraw does not ask again, and a
  loading picture shows (control). Run on Mortals: 9 PASS. Negative control against main: the two no-box assertions
  FAIL. Merged onto current main (after #8642): targeted list plus the check-list guards, 639 pass, 0 fail.

### Outstanding questions (ASKED)
- None.

### Owed outside this loop
- A real-board check with name.com and two other sites (card's done-when). "Takes forever" was not reproduced; every measured fetch was under half a second.

### NITs (non-blocking, across all iterations)
- LPV_FAILED keeps a picture that failed for a moment hidden until the page reloads (iterations 2, 5)
- imageState starts a background fetch; documented, not renamed (iterations 2 to 6)
- A dead domain's picture is re-resolved every minute while shown (iteration 7)
- The page's typeof guard serves lifted tests (iterations 4 to 8)

### Strengths (across all iterations)
- The verdict is kept apart from the bytes cache, so dropped bytes never decide a card's picture; a passing failure never turns a loaded picture bad, and a real answer does (tested with controls).
- One shared in-flight fetch per picture across the poll warm-up and both routes, with the background warm-ups capped at four.
- The cause was measured before the change (name.com's own og:image answers 404 to everyone).
