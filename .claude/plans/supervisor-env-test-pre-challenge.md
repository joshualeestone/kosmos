---
pre_challenge: true
method: challenge-loop
branch: supervisor-env-test
diff_hash: 33b577940f256614cf971497024602ac2cdac74b84bc20fdfffeadafcf2c016c
subdir_audit: passed
timestamp: 2026-08-24T18:33:35Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (bounded before iteration 5 ran, stated to the PM: iteration 5 must find zero new BLOCKER, WARNING or CONVENTION across the three changed files; anything it finds is recorded, not fixed; no sixth round under any finding)
**Converged:** Yes
**Total findings:** 23 (0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 16 NITs)
**Fixed:** 20 (7 WARNINGs, 13 NITs) | **Recorded, not fixed:** 3 NITs (iteration 5, carded as follow-ups in the PR)

Validation (the canonical helper: full suite plus subdir audit) ran after every fix round and on the final commit: 1826 of 1826, exit 0, audit exit 0, tree clean. Independent of the double: tools/witness-pane-env.sh run on real tmux 3.6a after every round, FAIL against the pre-#586 supervisor (70eddf3, pane saw /acct/A) and pass against this branch (pane saw /acct/B). prove-it-fails with the -e forwarding dropped: the new test red, tree restored.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs
- [WARNING] engine/create.test.js:1078 — the behavioural test reached only one of the four launch lines --> FIXED (151947b: runLauncher takes model and runner; the set case runs all four branches)
- [WARNING] tools/witness-pane-env.sh:27 — mktemp -d unchecked, empty D on failure --> FIXED (151947b)
- [NIT] tools/witness-pane-env.sh:24 — variable named TMUX shadows tmux's own --> FIXED (151947b: TMUX_PATH)
- [NIT] tools/witness-pane-env.sh:17 — exit 2 undocumented --> FIXED (151947b)
- [NIT] tools/witness-pane-env.sh:41 — unset prints as a bare rc line; read between two writes --> FIXED (151947b)
- [NIT] package.json:9 — witness not in test:shell --> FIXED (151947b)
- [NIT] engine/create.test.js:967 — calls.newSession undiscoverable --> FIXED (151947b: comment at the return)
- [NIT] tools/witness-pane-env.sh:15 — the negative control undated --> FIXED (151947b: dated measurement in header and plan)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] tools/witness-pane-env.sh:52 — no in-script control; operator tmux.conf read --> FIXED (458cf11: control session under B must see A else exit 2; -f /dev/null)
- [NIT] engine/create.test.js:1086 — branch identity asserted one way only --> FIXED (458cf11)
- [NIT] tools/witness-pane-env.sh:36 — supervisor's sleep orphaned past teardown --> FIXED (458cf11: process group under set -m; macOS has no setsid)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/create.test.js:1093 — -e pairs after the runner binary would still satisfy the set-equality --> FIXED (7214de3: every -e must sit before the runner)
- [WARNING] tools/witness-pane-env.sh:71 — a control pane that never ran reported as a forwarding tmux --> FIXED (7214de3)
- [NIT] engine/create.test.js:1073 — "launchd-shaped environment" overclaims --> FIXED (7214de3)

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] tools/witness-pane-env.sh:76 — the control's exit path named forwarding for any non-A value --> FIXED (3d3d7f1: B means forwarding, anything else means a tmux the witness does not model)
- [WARNING] tools/witness-pane-env.sh:53 — TMUX_BIN and TMPDIR interpolated into generated shell source --> FIXED (3d3d7f1: wrappers read exported variables; quoted heredocs)
- [NIT] engine/create.test.js:1073 — comment implied a plist shape that carries all three --> FIXED (3d3d7f1)
- [NIT] engine/create.test.js:92 — runner = undefined default is a no-op --> FIXED (3d3d7f1)
- [NIT] engine/create.test.js:906 — "generated startup script" wording predates the shipped file --> FIXED (3d3d7f1, first line; the deeper sentence at :910 is pre-existing and left)

#### Iteration 5 (final, bounded)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] engine/create.test.js:1118 — unset and empty cases run the default launch line only --> RECORDED: follow-up card; the text test keeps PANE_ENV on every line so the escape is narrow
- [NIT] tools/witness-pane-env.sh:98 — a missing rc line falls through to a verdict after the timeout --> RECORDED: follow-up card
- [NIT] tools/witness-pane-env.sh:86 — group kill depends on set -m having a controlling terminal --> RECORDED: follow-up card

### STRENGTHs (across iterations)
- Presence before absence: every -e assertion is guarded by "nothing was launched, so the assertions below never ran".
- env with undefined meaning REMOVE makes the unset case real on a machine whose own CLAUDE_CONFIG_DIR is set.
- argv recorded with boundaries makes the Application Support space measurable; calls keeps its shape for every existing caller.
- The witness carries its own control, isolates socket and config, feeds values through exported variables, and separates setup failure (2) from verdict (1); its negative control is a dated measurement against a named sha.
- Rounds 1 and 2 found things about the change; 3 and 4 found things about the fixes. That was the tell that bounded round 5.
