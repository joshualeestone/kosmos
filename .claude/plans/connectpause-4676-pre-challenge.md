---
pre_challenge: true
method: challenge-loop
branch: connectpause-4676
diff_hash: 180dcfec89b0989edc8335f2c7ba52aaea33c9072a6ab9e3a5bddd773f0a996b
validation: targeted (install.connect-pause-4676.test.js 13/13; tools/test-install-static.sh 23/23; cli.exit-code-mapping-3628.test.js 6/6; tools/test-setup-pause-sandbox-4651.sh 35 pass / 0 fail after the unbound-var guard; bash -n on setup.sh; dash sweep clean; node --check on the test). A full shell suite (npm run test:shell) at the new head is being run per Liu Kang (m5691) before push. Liu's "light runs only" (m3810) was relaxed here because setup.sh changed and cross-file tests caught real issues. GitHub CI authoritative.
subdir_audit: passed
timestamp: 2026-10-15T10:03:37Z
iterations: 3
converged: true
---

## [REVIVAL] Rebase onto post-#5462 main, re-validation, blind re-challenge (2026-10-15)

This branch was first validated on 2026-09-30 (the challenge-loop summary below). It then sat
open as PR #4759 while main moved ~4766 commits ahead. Scorpion's triage recommended reviving it:
#4651/PR #5462 ("the update pause fails closed in a sandboxed shell", merged 2026-10-07) reshaped
the gone-by-port lsof wait, adding a fail-closed `_lsofbad` heuristic. Scorpion's approval of the
OLD head (95eb210b9) is orphaned by the rebase; this goes back to Liu Kang for review at the new head.

### Rebase
The branch's net change (one squashed commit) was cherry-picked onto a fresh `origin/main`, then
rebased again onto the current tip `0279d48ec` (the 52 commits since the first rebase touched nothing
in `install/setup.sh`, so that rebase was clean and the code is byte-identical to the r2-validated
tree). Final shape: one commit on `origin/main`, files `install/setup.sh`, `install.connect-pause-4676.test.js`,
and the two plan/proof `.md` files.

### The one conflict, and how it was resolved (install/setup.sh gone-by-port lsof wait)
#5462 rewrote this wait to read `lsof` once (`_lsofout`/`_lsofrc`), parse numeric pids with sed, and
set `_lsofbad=yes` (fail closed) when `lsof` returned NO pids but exited >1 or printed non-empty output.
#4676 narrows the found pids to only OUR server's listener (full-path `/bin/ps` command match, anchored
on the space before the path) when the pause deliberately left another install's board on the port
(`_kosmos_pause_left_foreign=yes`). Resolution: kept #5462's HEAD version FIRST (the `_lsofbad` block,
which reads the UNFILTERED lsof output), then layered the #4676 foreign-filter AFTER it, inside the same
`_pids`-non-empty iteration. The two are mutually exclusive per iteration: `_lsofbad` is computed only in
the `[ -z "$_pids" ]` branch; the filter runs only when raw lsof returned a numeric pid. So narrowing to
none-of-ours reads as "the only listener is the foreign board, proceed", and can never mask a genuine
port-check failure.

### r1 failure (6/13) and its fix: a stale-test-vs-#5462-reshape problem, NOT branch logic
First re-validation (queued-heavy task bcy0uz322) came back 6 pass / 7 fail. Every failing test was one
that RUNS the extracted pause BLOCK; each died right after the first info line, before any assertion.
Root cause (proven by a local smoke): #4920 added `_kosmos_linux_unit_killmode()` (defined at setup.sh
L204, OUTSIDE the extracted block, called right after the first info line); the test harness stubbed
`info`/`die`/`_kosmos_mode_read` but not this function, so under `set -euo pipefail` it was command-not-found
and aborted. It would fail identically on plain origin/main. Fix: added one faithful stub to the harness,
`_kosmos_linux_unit_killmode() { :; }`, with a comment noting it is a Linux-only no-op (`uname -s` guard at
setup.sh L204-205) added after this card's base, so the stub exactly mirrors shipped behavior on the Mac
where these lsof/ps tests run. It weakens no assertion.

### r2: 13/13 pass (queued-heavy task bsrhj3iy4)
All 13 tests green, including the two that directly exercise the resolution:
- "a connect computer updates past another install's board, and is never told to kill it" (boots a real
  stub server.js on the port; asserts "it is not this install's ... so it is left alone", and does NOT
  match kill/still-holding-port).
- "a connect computer whose OWN board holds the port behind a stale board.pid still does not update under
  it" (real board boot; asserts the DIE).

### Blind re-challenge (fresh general-purpose agent, blind to my conclusions)
Focused on the conflict resolution + the test stub. Verdict: NO BLOCKER, NO WARNING. It independently
confirmed the card's single most important guarantee (our own live board behind a stale board.pid still
dies via the command-based filter, not the pidfile check) and ruled out proceed-when-should-stop,
kill-the-foreign-board, ordering, ps-match misclassification, and test-stub masking. Two NITs:
- NIT 1 (fixed): two comments claimed the filter uses "the same full-path ps match the pause uses", but
  the filter (L3759) anchors on the leading space while the pause's own-board check (L3664) does not.
  Corrected both comments to describe the stricter anchor accurately. These are inert shell comments
  inside the extracted BLOCK; bash -n re-confirmed, no executable token changed, so r2's 13/13 stands
  without a re-run (weakest part of this judgment: I did not re-run the heavy test for the comment fix,
  relying on bash -n plus the fact that comments are inert to the shell parser).
- NIT 2 (deferred, not this card): setup.sh:~5472 lifts board.stopped on `BOARD_OURS` alone without
  re-probing the port (unlike the connect branch). Benign (launchd's board-run exits quietly while a
  stranger holds the port), and the code explicitly scopes it to the next start's #3079 reclaim, filed
  as #4679 and routed to Scorpion. Expanding into it is #4679's scope, not #4676's.

### CI caught a static-guard break; Liu ruled the fix (board-decide restructure)
The first revived head failed CI check `test-linux-setup`: `tools/test-install-static.sh` 22/23, the one
red being `tools/lib/install-static-checks.sh` #82 ("the run ends by stopping a board that became connect
during it"). Root cause: the #4676 end-of-run change had prepended its marker-lift branch to the
board-decide chain, demoting the connect-stop `if [ "$_kosmos_mode_word" = connect ] && [ "$BOARD_OURS" = yes ]`
to an `elif`, so #82's `^if`-anchored grep no longer matched. The connect-stop behaviour was preserved
(the branches are mutually exclusive), so this was a static-guard anchor break, not a behavioural
regression; and #82 is present at the branch merge-base (0279d48ec), so it is not a moved-test artifact.
Liu Kang ruled (m5672, m5673): split into two standalone `if`s, do NOT widen #82 to accept `elif`
(widening a guard so a change fits it is the wrong direction). Scorpion independently confirmed the two
assigned focus items PASS (the `_lsofbad` ordering and the #4920 stub) and gave the same split guidance
(m5670, m5674), with the caution to keep the connect-stop and the `_kosmos_board_off=no && _kosmos_wrote_marker=yes`
branch in their original `if/elif` relationship. Fix applied exactly that: a standalone
`if _kosmos_off_for_foreign && [ "$BOARD_OURS" = yes ]` (lift marker), then the original connect-stop
`if`/`elif` chain unchanged from main. `tools/test-install-static.sh` back to 23/23 locally; the 5
end-of-run block tests re-run green; the test's `LAST` extraction anchor was made robust (skips the
new comment/blank lines rather than a fixed offset). Weakest part: this restructure is executable, and I
did not run the full heavy 13/13 again for it; I rely on the 5 end-of-run tests (which are the only ones
that exercise this block, none gated on lsof), CI's `suite (node)`, the mutual-exclusivity proof, and the
byte-identical gone-by-port region for the 4 lsof tests.

### CI caught a second issue: the #3628 exit-code guard flagged the test harness
CI `suite (node)` then failed on `cli.exit-code-mapping-3628.test.js` ("no test file reads a missing exit
code as a number or null"). This is a cross-file guard that scans every `.test.js`; it was invisible to
running `install.connect-pause-4676.test.js` alone (what r2 and Scorpion's local run did), which is why
only the full node suite caught it. Root cause: both harnesses in this test read `err ? (err.code ?? 1) : 0`,
and a run killed by the `execFile` timeout gives `err.code === null`, so `?? 1` would read a kill as a clean
failure (exactly #3628's bug). Fix (test file only, no setup.sh change): both harnesses now reject when
there is no numeric exit code (`if (err && typeof err.code !== 'number') reject(...)`), the canonical
#3628 shape, then resolve `code: err ? err.code : 0`. `cli.exit-code-mapping-3628.test.js` now 6/6 locally;
the UNSAFE/BARE scans are clean on this file; the 5 end-of-run tests still green (the reject never fires on
a normal passing run, so behaviour is unchanged for all passing cases). setup.sh stayed byte-identical, so
Scorpion's resolution review at 1a2ef6756 still holds; the head moved only for the test harness.

### CI caught a third issue: an unbound variable under set -u (the real cause of the shell 2/2 red)
CI `suite (shell 2/2)` then failed on `tools/test-setup-pause-sandbox-4651.sh` (19 failures). First read looked
like the self-hosted runner's lsof ("Operation not permitted"), but Liu Kang flagged that #6202 passed that
same shard ~1hr earlier, so lsof was not broken runner-wide, and the change is inside the exact block that test
drives. Running the test locally (quiet box, working lsof) reproduced the failure: 17 of 19 were
`_kosmos_pause_left_foreign: unbound variable` at the gone-by-port wait. That test extracts a NARROWER region
of setup.sh than this card's own test does, including the gone-by-port wait but NOT the `_kosmos_pause_left_foreign=no`
init (L3618), so under `set -u` the bare reference aborted. This card's own test passed because it extracts a
wider region that includes the init; main has no such reference at all, so main passed. Fix: guard the one bare
reference as `${_kosmos_pause_left_foreign:-no}`, matching the two references that were already guarded (the
helper and the board-decide). Re-run: `tools/test-setup-pause-sandbox-4651.sh` 35 pass / 0 fail / 0 lsof-perm
lines; the 2 lsof-perm lines in the first run were cascade artifacts of the unbound abort orphaning a stub
listener, gone with the fix. LESSON (also the strongest thread through all three CI catches): a check that
passes when you run one file in isolation can still be red in the full suite, because a sibling test extracts a
different region or scans across files. Every new shell variable referenced in setup.sh must be guarded with a
default (or its init included), because a test may extract a region without the init and run it under `set -u`.

---

## [CHALLENGE-LOOP] Summary (original, 2026-09-30)

**Iterations:** 2
**Converged:** Yes (round 2: nothing above NIT; its 3 NITs applied)
**Total findings:** 14 (0 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 6 NITs) plus Scorpion's plan review (1 change to fix 1, applied)
**Fixed:** 13 | **Deferred:** 1 (the next start's #3079 reclaim, filed as #4679, routed to Scorpion) | **Asked:** 0

Account-g has no pre-challenge gate hook, so I ran the loop myself (blind fresh agents, opus then sonnet),
with the PM's kill rule verbatim in each brief.

#### Iteration 1 (opus) at 1eda116de: 0 BLOCKER, 4 WARNING, 3 NIT, all fixed at 39e22e3f6 (after rebase)
- [WARNING] install/setup.sh: the new "another Kosmos is using port N" wording reached an UNREADABLE choice too (the carve-out fires for any keep-off mode), telling it to run 'kosmos start'. Fixed: _kosmos_off_for_foreign (flag AND run|both) gates every new branch; test red without.
- [WARNING] install/setup.sh: our own board up by the last reading on a run computer fell into the "could not be read, a board is still running" summary. Fixed: treated as running, board.stopped lifted; test red without.
- [WARNING] install/setup.sh: "stays off while another Kosmos is using port N" implied self-recovery (board.stopped stays). Fixed: "until you run 'kosmos start' (another Kosmos was using port N)".
- [WARNING] install.connect-pause-4676.test.js: the start step, summary and marker were never run by a test. Fixed: extracted-block arms with a recording bin/kosmos, plus connect/unreadable/no-other-board controls.
- [NIT] ours-match anchored on the space before the path. Fixed.
- [NIT] plist-write-failure line said the icon starts it. Fixed.
- [NIT] the next start's #3079 reclaim residual named in the comment; filed as #4679 (Scorpion).

#### Iteration 2 (sonnet) at c34c004bc: 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT -> converged; NITs applied at dd32a85ff
- [NIT] "was using port N when this update started" (the flag records the pause, not now). Fixed; tested.
- [NIT] the plist-failure icon line was not pinned by a test. Fixed (red when reverted).
- [NIT] the flag comment overclaimed "every later start or restart point"; names its one exception now.

### Mutants (each red, file restored and cmp-checked)
skip the whole wait (1), no ours-filter (2), no decide gate (1), any-mode off_for_foreign (2), no ours-up branch (1), icon line reverted (1).

### Not mine, measured
server.connect.test.js "GET /api/accounts confirms each OpenAI account live too" fails on this box with MAIN's setup.sh as well
(environment); tools.no-phone-home-4253 fails only on the Xcode licence (git exit 69) and passes with DEVELOPER_DIR.
