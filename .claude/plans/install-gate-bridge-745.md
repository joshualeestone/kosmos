# Install gate: a mismatch in what the install added names its paths

Branch `install-gate-bridge-745`, on top of #767 (Baron's expectation fix). Harness only.

## What happened

The third 0.5.24 cut (22:03) stopped at step 4b, the install gate (#624): "and the only thing it added is the supervisor the agents point at", 74 passed, 1 failed. The bundle was correct (#745 made the codex bridge's copy succeed, so the install adds two files) and the expectation was stale; #767 fixed the expectation. But the red named no path: it said the additions were not the expected set and left three agents to reproduce the run to learn which file. That cost about an hour.

## What changed

`tools/test-install.sh`, after the additions check: on a mismatch, print "added, not expected" and "expected, not added" with the paths, or "(none)" for an empty side. The check's sentence says what it checks (the supervisor and the codex bridge; #767 left the one-file wording), and the paragraph above the expectation says "ones", not "one". Every grep ends `|| true` because the harness runs under `set -euo pipefail`: the first version of this block ended the run after the first red, at 8 lines with no summary, and the control caught it.

## Finished when

- The block by itself, under `/bin/bash` 3.2 with `set -euo pipefail`, survives six inputs (empty, the old one-file set, an exact match, one extra, reversed order, a staging leftover) with exit 0 and prints "(none)" for an empty side.
- A build from this tree passes the gate (75 passed, 0 failed) and the block prints nothing.
- The one-file expectation restored as a control: red at this check, `./AgentWorkforce/bin/codex-report-bridge.js` under "added, not expected", "(none)" under "expected, not added", and the run reaches its summary (74 passed, 1 failed).

## Review

One blind round on the pre-rebase diff: the conflict with #767 (cured by the rebase), the plan's stale claims (rewritten), the blank line on an empty `ADDED` and the headers over empty lists (both now "(none)"), the redundant `:` (gone with the `if` form), the "EXACTLY the one" paragraph (fixed). Deferred: a pre-existing em dash at line 398, not this change's.

## Not in this change

Deriving the expected additions from the engine; the list stays a claim so a surprise write into the person's data directory stays red.
