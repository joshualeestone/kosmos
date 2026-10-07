---
pre_challenge: true
method: challenge-loop
branch: restartnote-5359
diff_hash: f9d5b7f27ec16afca4f7dbe48ffcf123a5c55a7476df085250181bb9d38cba80
validation: passed (Mortals full suite at 8933010f6, hash f9d5b7f27ec1; FULL browser checks passed at 7d4843971, the same tree)
subdir_audit: passed
timestamp: 2026-10-07T16:20:28Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (blind reviewers alternated between Opus and Sonnet)
**Converged:** Yes (iteration 9, Sonnet: one WARNING that repeats review 3's decided live-region point, and NITs; no code change)
**Total findings:** 0 BLOCKERs, 20 WARNINGs, 2 CONVENTIONs, NITs
**Fixed:** 19 | **Deferred:** 3 (two recorded as decided limits, one filed as #5450) | **Asked (awaiting user):** 0

Local evidence at 2384b039d: engine/restartnote-5359 7/7, server.restartnote-5359, cli.restartnote-stop-5359 3/3,
install.uninstall-remembered-1531 5/5 and the repo guards 57/57 together; render-reboot-note-5359.js all PASS on a fully
sandboxed board. Every guard added in the loop has a mutation that turns it red (listed per review in the plan).

### Per-Iteration Breakdown

- [WARNING] Iteration 1: kosmos stop did not clear the record; the page never re-checked; dismiss emptied before the
  board recorded it; temp files left on a failed write. FIXED.
- [WARNING] Iteration 2: the stop-path clear ran before the kill (a beat could restore it; a failed stop erased a live
  record). FIXED, pinned by cli.restartnote-stop-5359. The "deliberate stop never makes a note" claim was narrowed;
  clearing on SIGTERM REJECTED (an ordinary shutdown SIGTERMs every process). The ten-minute re-check took focus off
  Dismiss. FIXED. No test of the stop path. FIXED.
- [WARNING] Iteration 3: my iteration 2 guard keyed on times blocked the midnight wording change. FIXED (keyed on words,
  midnight arm with a pinned page clock). Long outages and Windows Fast Startup: DEFERRED as decided limits, reasoned in
  the plan. The live region arrives filled: decided, consistent with the login notice.
- [WARNING] Iteration 4: "by itself" decided by a timer, not the supervisor: DEFERRED, filed as #5450. Dark tones,
  the board-restart re-check, and a failed dismiss were unguarded or silent. FIXED, each pinned.
- [WARNING] Iteration 5: the once-a-minute beat was unpinned; uninstall left both files. FIXED, both pinned.
- [WARNING] Iteration 6: focus after dismiss unpinned. FIXED. World switch named and added to #5450. [CONVENTION] the
  check's header and README row did not list every arm. FIXED.
- [WARNING] Iteration 7: window edges, the phone line, and the yesterday line were loosely pinned. FIXED.
- [WARNING] Iteration 8: Kosmos+ in light was unguarded (my iteration 6 change moved the arm to dark, where the dark rule
  masks it); focus dropped when a re-check repainted or removed the note; a stale failure line stayed. FIXED, each
  mutation-proven. [CONVENTION] the phone arm missing from the README. FIXED.
- [WARNING] Iteration 9: the live region arrives filled (duplicate of iteration 3's decided point). [NIT]s: the head and
  line may be read run together; the re-check fires in a hidden tab; a second start() in one process arms two beats.
  Left as decided.

### After convergence (disclosed)

Three commits landed after iteration 9, none a review finding:
- ca85f46a9 moves the one start-up line `rn.atStart(); rn.startBeating();` below the file-preview sweep in server.js
  start(), because the full suite's server.preview-sweep-5254 source pin requires the sweep within 400 characters of
  `function start(port = PORT) {`. Same call, same arguments, a later line in the same function; not re-reviewed.
- 7d4843971 merges main (conflicts resolved as unions).
- 8933010f6 is an empty commit carrying six Browser-check-surface trailers: the surface gate named six checks for
  additive tokens (.utoast.reboot, #reboot-slot); the FULL browser checks had passed on that exact tree.
The first full suite at 7d4843971 passed its node part (16013 tests) and went red only on that surface gate; the
re-run at 8933010f6 passed.
