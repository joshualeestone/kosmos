---
pre_challenge: true
method: challenge-loop
branch: sweeproster-7693
diff_hash: 4588ed1958c09221a1934a4ff420f1b496c92cbf92d10d7684539b940945663f
subdir_audit: passed
timestamp: 2026-11-02T18:32:49Z
converged: false
---

## Two blind review rounds, findings fixed, not converged

Change: four timer sweeps decide from one roster reading at most 20 s old; their sends read fresh.

## Round 1 (first design shared the reading for sends too)
- [BLOCKER] three of the four sweeps type into a pane from the card, and chat.js reads the screen only for a working or needs-you card, so a 20 s old idle card could let a line and its Enter land on a question menu. FIXED: every send reads a fresh roster.
- [WARN] the Antigravity resume could land mid-turn if the report lags: covered by the fresh send.
- [NIT] a trust dialog after a restart within the window: covered by the fresh send.
- Clean: snapshot side effects still run many times a minute from other callers.

## Round 2
- [WARN] each Assigner give and ask paid its own fresh capture. FIXED: one fresh read per tick, shared.
- [WARN] assigner.js comment said a menu hold cannot reach the ask. FIXED.
- [NIT] a failed fresh read: the Assigner falls back to the tick's roster, the others refuse. Left, written here.
- Clean: no keystroke path takes the old card; Gemini checks the pane fresh before its one key; no reentrancy.

## Measured
191 tests across the four sweeps and the pinned wiring pass; the new wiring test fails when a send goes back to the shared reading (mutation checked). Full suite left to CI. Not measured on a loaded board yet: the next release's slow-spawn lines are the measure.
