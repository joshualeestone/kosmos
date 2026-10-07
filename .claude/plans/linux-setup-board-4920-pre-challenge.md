---
method: challenge-loop
branch: linux-setup-board-4920
diff_hash: 50afb6a4dd405d1840e84dfb079d18c4be08974cfea64c434d27ab1207d1bf8c
timestamp: 2026-10-07T14:28:48Z
converged: true
---

# Challenge-loop proof: linux-setup-board-4920 (#4920 follow-up: setup.sh uses piece B's board unit on Linux)

setup.sh on Linux installs and removes the board's systemd unit through engine/linuxboard.js (installBoard,
loadedBoardJob, removeBoard, boardUnitPath) instead of writing its own; the shell copy had Restart=always (a restart
loop on a stopped board) and no KillMode=process. It hands the board to systemd only when systemd is not already
running it and linger is on, restarts a held board once when an update changed its unit, gives an old 0.7.27 unit
KillMode=process before any stop (update pause and uninstall), removes the unit in every uninstall case (including an
older release, a missing node, a missing app folder) without touching another install's unit, and says one true
sentence for every outcome. The installer test harnesses run setup.sh's own option line (dash refuses set -o pipefail).

Reviewed as D's own commits (68418d08b onward), first stacked on piece B, then moved onto main after B merged
(5847ec2cc); the per-file diff against main equals the stacked branch's own. Blind reviewers alternated Opus and
Sonnet for 21 iterations; iteration 21 found nothing new after deduplication (one accepted outcome in B's start step),
so the loop converged.

Real Linux (the workflow, dispatched; dash; real systemd; this checkout installed via KOSMOS_SRC): all steps green,
including a restart-loop CONTROL (Restart=always moves NRestarts, on-failure does not) before the real check, the
KillMode fix measured both ways (the old unit kills its child; fixed, the child survives), and an end-to-end update from
a real 0.7.27 install (its own app and kosmos, staged from 28c352bc0) that lands on B's unit, restarts once after the
rewrite (measured by start time), and holds with no restarts.

Full validation on HEAD 5b1bfba09 (09:22 to 09:27 CDT, 2026-10-07): 16413 tests, 16188 pass, 1 fail, which is main's
known red cli.sandbox-4636 'a truly HUNG board' test (fixed on main by #5474, merged 09:00; this branch predates it);
validation helper otherwise clean; subdir audit rc 0.

#### Iteration 1
- [WARNING] .github/workflows/test-linux-setup-4920.yml:88 (SELF): stay-stopped check never involves systemd. FIXED: f9bde58bf (systemd-owned first, is-active checks)
- [WARNING] .github/workflows/test-linux-setup-4920.yml:106 (SELF): is-enabled after delete cannot fail. FIXED: f9bde58bf (wants link absent)
- [WARNING] install/setup.sh:1424 (SELF): fallback blames another install's unit. FIXED: f9bde58bf (names each file, may be another's, B's dir rule)
- [NIT] stderr into _lb_out (FIXED); require outside try (FIXED); old uninstall deleted file without systemctl (left: installBoard needs systemctl); stale comments (FIXED); hand-copied options (FIXED, read from setup.sh); shell sentence branch untested (left).

#### Iteration 2
- [WARNING] install/setup.sh:1412 (SELF(it1 fix)): no-systemctl uninstall blamed a missing app folder. FIXED: ae22ccc50 (own branch; tested)
- [WARNING] install/setup.sh:4054 (SELF): empty node output gives an empty reason. FIXED: ae22ccc50 (names node + linuxboard.js; tested)
- [WARNING] install/setup.sh:4046 (PRE-EXISTING(D on main)): board not handed to systemd; message true only after reboot. FIXED: ae22ccc50 (kosmos restart --force as on the Mac; workflow is-active)
- [WARNING] install.linux-board-4920.test.js (SELF): shell wrapper untested. FIXED: ae22ccc50 (6 wrapper tests; 3 plants red)
- [NIT] uninstall empty reason (FIXED); printf-spelled unit not caught by text guard ([Service] still caught, left); sleep 12 tied to RestartSec (comment added).

#### Iteration 3
- [WARNING] install/setup.sh:4069 (SELF(it2 fix)): hand-off restart bounces the board on every update. FIXED: 562180fd1 (new unit only; 2 plants red)
- [WARNING] .github/workflows/test-linux-setup-4920.yml:99 (SELF(it1 fix)): stay-stopped check cannot see the #4918 loop. FIXED: 562180fd1 (board.stopped + TERM + NRestarts)
- [NIT] stale workflow comment (FIXED); sandbox wording (left: safer than before); no-systemctl leaves file (left); multi-line require error (FIXED); plan counts (FIXED).

#### Iteration 4
- [WARNING] install/setup.sh:4058 (SELF(it3 fix)): hand-off keyed on file existence misses a failed earlier hand-off. FIXED: 8d4dc7e26 (asks systemd via loadedBoardJob; plant red)
- [WARNING] .github/workflows/test-linux-setup-4920.yml:105 (SELF(it3 fix)): NRestarts read timing on a slow runner. DEFERRED: accepted: 12 s = two RestartSec windows; recorded in the plan
- [NIT] uninstall wording (FIXED); cat stub (FIXED); cut() indentation-anchored (left, fails loudly); stderr dropped (left, empty output is said).

#### Iteration 5
- [WARNING] install/setup.sh:1411 (SELF): failed removeBoard leaves an enabled unit pointing at a deleted folder. FIXED: 5373796e1 (fallback delete of file + wants link; plant red)
- [WARNING] install/setup.sh:4081 (SELF(it2 fix)): hand-off without linger makes the board die at logout. FIXED: 5373796e1 (only 'loose lingering'; plant red)
- [NIT] launcher tmux pick in unit (FIXED, plant red); multi-line because (FIXED); linuxboard header (FIXED); workflow comment (FIXED). New guard: bash 3.2 snippet shape (plant red).

#### Iteration 6
- [WARNING] install/setup.sh:4105 (SELF(it2 fix)): failed hand-off restart swallowed; success sentence with board down. FIXED: 8fce71a07 (said + kosmos start; plant red)
- [WARNING] install/setup.sh:4081 (SELF(it5 fix)): dropping launcher tmux pick strands an odd-PATH tmux. DEFERRED: measured not real on Linux: setup_linux_tmux symlink + install/kosmos falls back to $KOSMOS_HOME/tmux/bin/tmux; plan
- [WARNING] engine/linuxboard.js unitSafe (BASE(B)): refusal of $ % quote backslash is a behaviour change. DEFERRED: accepted + said; plan records it
- [NIT] guard test title (FIXED); SETUP_SH_OPTIONS in three files (left, each reads setup.sh); TERM assumption note (in workflow comment); glob safety (fine).

#### Iteration 7
- [WARNING] .github/workflows/test-linux-setup-4920.yml:55 (SELF(base workflow)): CI runs bash, people run sh (dash). FIXED: baf77f34c (sh in all four steps; block tests under dash)
- [WARNING] install/setup.sh:4066 (SELF(it3 fix)): update rewrites the unit after the restart, Environment= not applied. FIXED: baf77f34c (held-changed restart once; 2 plants red)
- [NIT] linger-off sentence (FIXED); failed hand-off sentence (FIXED); _kosmos_board_decide re-read untested (left: stubbed by design); held-not-lingering sentence (now asserted).

#### Iteration 8
- [WARNING] workflow loop step (SELF(it3)): empty NRestarts passes vacuously. FIXED: 820476862
- [WARNING] install/setup.sh uninstall fallback (SELF(it5)): does not say the board may still run. FIXED: 820476862
- [WARNING] install/setup.sh install close (SELF(it6)): success line after a failed hand-off. FIXED: 820476862 (2 plants red)
- [NIT] sandbox wording (FIXED, tested); option-line opaque throw (FIXED); hard-coded line numbers (FIXED); custom-home wants link (FIXED); header wrap (FIXED); shared helper (left).

#### Iteration 9
- [WARNING] install/setup.sh:4127 (SELF(it8 fix)): 'running now' after a failed hand-off on not-lingering. FIXED: d1e9866fb (plant red)
- [WARNING] install/setup.sh:1413 (SELF): uninstall of an install from main's release cannot remove its shell unit. FIXED: d1e9866fb (legacy rule removal; plant red)
- [NIT] staged list drift (left; plan); board-off no-systemctl wording (FIXED); restart reason names board.log (FIXED); sandboxed uninstall wording (FIXED, plant red).

#### Iteration 10
- [WARNING] install/setup.sh:1416 (SELF(it9)): shell vs path.resolve hash for odd KOSMOS_HOME. DEFERRED: measured: setup.sh normalizes slashes and refuses relative; only . or .. could differ; plan
- [WARNING] install/setup.sh:1408 (SELF): uninstall lacks XDG_RUNTIME_DIR. FIXED: 651944557
- [NIT] launcher-pick branch reachable via in-app update (comment added; nit was wrong); staged list drift (left); loadedBoardJob ok:false -> one spare bounce (accepted).

#### Iteration 11
- [WARNING] install/setup.sh:4083 (SELF): update from a 0.7.27 unit (no KillMode) kills the update and tmux at the pause. FIXED: 2c8f08b61 (KillMode=process added before the pause; 2 plants red); reasoned, not measured
- [NIT] older install + no systemctl wording (left, no user manager); unreachable LAUNCH arm (FIXED); sandbox phrase coupling (left); failed held-changed restart not retried (left); linger not disabled on uninstall (pre-existing, left).

#### Iteration 12
- [WARNING] install/setup.sh sandbox match (SELF(it8)): sandbox sentence coupled to linuxboard text untested. FIXED: 343c8838a (real installBoard test; plant red)
- [WARNING] install/setup.sh sandboxed install (SELF(it8)): 'skipped' though the unit file is written in the sandbox. FIXED: 343c8838a (reworded)
- [WARNING] install/setup.sh uninstall (SELF(it9/11)): older install + no systemctl says app missing. FIXED: 343c8838a (plant red)
- [NIT] install/setup.sh:209 (SELF(it11)): temp name lost $ (String.replace $$). FIXED: 343c8838a; all diffs scanned
- [NIT] require-fails path vague (left); 3-shape guard heuristic (left; bash -n + /bin/sh runs are the real check); sleep 12 (accepted).

#### Iteration 13
- [WARNING] install/setup.sh:1450 (SELF(it9/12)): linuxboard present, node gone: wrong branch, false sentence, unit left. FIXED: 47f371b18 (shell-rule removal when linuxboard cannot run; plant red)
- [WARNING] install/setup.sh:4186 (SELF(it9)): held + no linger told it survives until a restart. FIXED: 47f371b18 (plant red)
- [NIT] killmode XDG_RUNTIME_DIR (FIXED); mv replaces a symlinked unit (left: Kosmos-written units); dash/Mac CI note (test.yml runs it on the Mac).

#### Iteration 14
- [WARNING] workflow (SELF(it11)): KillMode fix reasoned, not measured. FIXED: 952a3cfd7 (real-systemd step, control + fix) PENDING the run
- [WARNING] workflow staging (SELF): hand copy of bundle list. DEFERRED: named in the step comment; build script is Mac-only
- [WARNING] install/setup.sh failed hand-off (SELF): may be running on old settings. FIXED: 952a3cfd7
- [NIT] mv resets file mode (left); leftover glob (fine); heredoc warning (guard test covers); sleep 12 (accepted).

#### Iteration 15
- [WARNING] install/setup.sh:1364 (SELF(it11)): uninstall's stop has the same cgroup hazard. FIXED: 45c2de08a (killmode before it; plant red)
- [WARNING] install/setup.sh:1501 (SELF(it11)): app-gone branch only names this home's unit. FIXED: 45c2de08a (removes it; others named; plant red)
- [NIT] linuxboard header boardUnitPath (FIXED); plan wording (FIXED); legacy silence (FIXED).

#### Iteration 16
- [WARNING] install/setup.sh uninstall snippet (SELF(it5)): require failure leaves the unit (fallback cannot name it). FIXED: 930e4e9d3 (shell removal by name; plant red)
- [WARNING] workflow loop step (SELF(it3)): no control that NRestarts moves under Restart=always. FIXED: 930e4e9d3 (throwaway-unit control both arms) PENDING the run
- [WARNING] workflow staging (SELF(it14)): hand-copied list. DEFERRED: dup of it14; named in the step
- [NIT] three option-line copies (left, each reads setup.sh); comment-strip scope (left); CRLF unit (left: only Kosmos-written units).

#### Iteration 17
- [WARNING] workflow (SELF): update path never run end to end on real systemd. FIXED: fcb1de264 (main's setup.sh then this one; PENDING the run)
- [NIT] exports test (FIXED); no-systemctl file removal (FIXED); unitSafe refusal on an update leaves old unit (left, rare); sandbox uninstall leaves sandbox unit (left); comment (FIXED); pid reuse (negligible); staged list (dup).

#### Iteration 18
- [WARNING] workflow e2e step (SELF(it17)): reads main's setup.sh; loose check. FIXED: d3e1404a3 (pinned 28c352bc0)
- [WARNING] install/setup.sh killmode (SELF(it11)): another KillMode line makes the fix a no-op. FIXED: d3e1404a3 (plant red)
- [WARNING] install/setup.sh hand-off comment (SELF(it5)): comment contradicts held-changed. FIXED: d3e1404a3
- [NIT] app-gone 'may keep running' (left); legacy flag (left); engine subdirs (left).

#### Iteration 19
- [WARNING] workflow e2e step (SELF(it17/18)): old install got this branch's kosmos (KOSMOS_SRC leak); update ran outside the board cgroup. FIXED: 71549103f (old tree staged from 28c352bc0; update inside the cgroup) PENDING the run
- [NIT] killmode early return (FIXED); mv on symlinked unit (left); unchecked rm message (left); plan summary (FIXED); daemon-reload under a test dir (left, matches linuxboard).

#### Iteration 20
- [WARNING] install/setup.sh killmode comment (SELF(it14)): 'measured' overstates: mechanism, not the in-app update. FIXED: 021a84ec3 (comment states the limit)
- [WARNING] install/setup.sh held-changed detector (SELF(it7)): text diff only. DEFERRED: reviewer: port and env are in the unit text, so they diff
- [WARNING] workflow timing (SELF(it3/16)): fixed sleeps. DEFERRED: dup, accepted in the plan
- [NIT] legacy flag (dup, left); 'may keep running' (honest, left); no [Service] line (unrealistic, left).

#### Iteration 21
- [WARNING] install/setup.sh hand-off + install/kosmos start (BASE(B)): no-linger first install moves under systemd at the next update. DEFERRED: accepted: B's start step (Angel's area); reported truthfully; plan
- [NIT] held-changed restart unmeasured (FIXED: ExecMainStartTimestamp vs unit mtime, PENDING run); removing-message when no unit (left); killmode post-check on odd headers (left); name-fn comment (FIXED).
- No new BLOCKER, WARNING or CONVENTION after deduplication and deferral. CONVERGED.

## Summary
- Iterations: 21. Converged at 21.
- Decided, with reasons in the plan: the in-cgroup end-to-end update (an I/O error moving into the board's cgroup;
  the hazard is covered by the KillMode measurement and a call-order test); a no-linger first install moves under
  systemd at the next update (piece B's start step, reported truthfully); fixed 12 s timing windows; the hand-copied
  staging list.

## After CI (2026-10-07)
- [BLOCKER] install/setup.sh: the KillMode line sat between the #5033 marker-set and the pause stop, so tools/test-update-putback-4818.sh (CI shell shard 1/2) went red --> FIXED 446a8e90c (moved above the marker). My earlier full validation ran the node suite only (yarn test); `yarn test:shell` was then run locally at 446a8e90c: rc 0.
