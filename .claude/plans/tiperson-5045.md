# tiperson-5045: tools/test-install.sh runs as a person

Card #5045 (sibling of #4619). Splinter asked for it as its own PR so it does not wait on #4382.

## Change
Unset KOSMOS_AGENT_SESSION, KOSMOS_AGENT_TOKEN and TMUX_PANE at the top of tools/test-install.sh, after
`set -euo pipefail`. The same three #4619 unset in test-board-watchdog-2955.sh for its person cases.

## Why it is safe
No arm in tools/test-install.sh tests agent behaviour (grep: no KOSMOS_AGENT_* or TMUX_PANE anywhere in the
file before this change). Every kosmos command in it plays a person, or the Mac app acting for one.

## Verification
- Control (the defect): 12:01 run from an agent pane, without the unset: 147 passed, 10 failed; the #4356
  arm's "board is down before the update" CONTROL failed.
- With the unset: the ifnewer-4382-harness rerun (same lines, same harness, queued 12:03 from the same pane).
  Predicted: the #4356 control passes.
- The release cut is unaffected either way (it runs on Mortals over ssh, which forwards only LANG/LC_*).

## Iterations
### Iteration 1 (sonnet, blind): 0 blockers, 0 warnings. CONVERGED.
Verified: no arm tests agent behaviour; TMUX_PANE's only guard use goes through the harness's FAKE tmux
(AGENT_WORKFORCE_TMUX_BIN, test-install.sh:325), so the real trigger was KOSMOS_AGENT_SESSION/TOKEN, which the
unset also clears; $TMUX need not be unset (install/kosmos reads none, and the bundled tmux has its own socket);
placement is before any kosmos call; matches #4619's one-line precedent.
Left: unsetting KOSMOS_RECLAIM_BUSY too (out of scope, not in this failure); comment wording nits.
