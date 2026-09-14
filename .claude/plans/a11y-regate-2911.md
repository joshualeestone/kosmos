# Plan: #2911 — detect BOTH Accessibility grants + tmux "step 3" ask

Branch: `a11y-regate-2911`  ·  Card: kosmos#2911 (claimed:angel, priority, josh-review)
Related: #2559 (re-gate), #2912 (advisory flip), #2451/#2125 (app-AX subject), #2685 (tmux file-access), #1940 (tmux AX on install)

## What "finished" looks like (true when done)
On the "Kosmos Never Sleeps" / Access (S3) screen:
1. The screen asks for tmux Accessibility (Josh's "step 3") alongside the Kosmos-app
   Accessibility ask — user turns on Kosmos, tmux, and accessibility.
2. The gate detects BOTH grants and blocks Continue only on a definite not-granted:
   - APP Accessibility — via appGrant() live TCC read (DONE, commit 75a53a79a).
   - TMUX Accessibility — via tmuxGrant() (client LIKE '%/tmux', realpath exact-match
     on the bundled tmux binary), wired as its own FR_GATES row.
3. Both gate rows are block-on-positive with uncheckable→non-blocking, so a browser /
   no-FDA / path-mismatch context is NEVER re-trapped (the #2912 lesson, applied to
   both halves).
4. False-premise comments corrected (DONE for a11ystatus.js).
5. node tests + challenge-loop proof + browser-checks all green. PR up, reviewer
   joshualeestone.

## The corrected model (measured, not inferred)
tmux DOES hold its own kTCCServiceAccessibility grant. Proof: this box's system
TCC.db shows `/opt/homebrew/Cellar/tmux/3.6a/bin/tmux | 2` (granted) and
`com.chaoskosmos.kosmos | 0`; Josh's fresh-install screenshot lists both Kosmos and
tmux ON; card #2911 says "turn on Kosmos, tmux, and accessibility"; ICK self-corrected.
The earlier "no tmux AX grant / tmuxGrant is the wrong subject" premise was an
over-generalized #2125 read and is wrong.

## Env / path de-risk (measured on the live board, pid 77681)
- Board env carries `AGENT_WORKFORCE_TMUX_BIN=/opt/homebrew/bin/tmux`, which
  realpath-resolves to `/opt/homebrew/Cellar/tmux/3.6a/bin/tmux` = exactly the granted
  TCC row. So tmuxGrant() in the board process matches the grant on this box.
- The env var IS the tmux the board picked/runs (KOSMOS_TMUX_BIN_PICKED=1), and macOS
  grants the binary it runs, so env-var and granted-binary are consistent by
  construction. tmuxGrant keyed on AGENT_WORKFORCE_TMUX_BIN is correct for the running
  board; the fail-safe covers any env-absent/path-mismatch edge.

## Approach (fill exact anchors from the code map)
- engine: appGrant() done. Confirm tmuxGrant() signature/verdict shape + path/env
  resolution; no engine change expected beyond exports already present.
- server.js: /api/a11y-status serves appGrant (done). Confirm the tmux-AX reading is
  served on a route the S3 gate can poll (existing tmux row POSTs /api/a11y-prompt per
  server.js:7920; a GET status route for tmuxGrant may need adding).
- web/index.html FR_GATES (~43953): add a tmux-accessibility gate row (granted/blocked
  off tmuxGrant's {checkable,trusted}); block-on-positive, uncheckable non-blocking.
- web/index.html S3 UI: add the tmux-accessibility ask block beside the app ask
  (extend the existing Screen-3 tmux row; coordinate region with Mona — her #3043 is
  agent-detail-header ~24455, her #3066 is room-scroll; both != FR_GATES region).
- browser-checks: bump any EXPECTED gate/ask counts (render-gated-next / render-createnav
  #1720 chain); run the FULL browser-checks suite, not just node.

## Weakest premise / what would change the design
On a fresh install the tmux AX row is keyed on the BUNDLED tmux
(`$KOSMOS_HOME/tmux/bin/tmux`), not Homebrew. If the board lacked AGENT_WORKFORCE_TMUX_BIN
the resolver falls back to /opt/homebrew/bin/tmux and could miss the row → "Checking…".
Mitigation: fail-safe (uncheckable→non-blocking) degrades to advisory, never traps.
Fresh-install TCC verification (Josh's fresh Mac / ICK w/ FDA) would confirm the keyed
path; a mismatch there would mean keying tmuxGrant off the picked-tmux differently.

## Explainer wording (tmux file-access folders) — PENDING fresh-GUI observation; not shipped here.

## Test plan
- node engine tests: extend the a11ystatus test with tmuxGrant dispositions (granted /
  not-granted / uncheckable) using setSqliteRunner; assert the FR_GATES tmux row
  granted/blocked predicates. Assert expected test COUNT (filter-matching-nothing exits 0).
- browser-checks full suite (render-gated-next / render-createnav), local.
- challenge-loop to convergence → proof file → PR.
