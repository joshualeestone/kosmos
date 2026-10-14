---
pre_challenge: true
method: challenge-loop
branch: qwenguide-5977
diff_hash: ef7374b35ecf17dae3c0fd6ebce6997378b66b53456d6ca68061eb2973b5358c
validation: targeted
timestamp: 2026-10-13T20:58:26Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

kosmos#5977 follow-up for the 0.7.47 cut: the agents' provider guide said Qwen was coming soon, and review 3 found
that every Qwen account add was refused on main (the route asked resolveBin for 'codex'). Four blind read-only
rounds alternating opus and sonnet; round 4 found no blocker, warning or concern. Details in
.claude/plans/qwenguide-5977.md.

**Iterations:** 4
**Converged:** Yes (round 4)
**Validation:** targeted, not the full local suite (the local queue is about 10 deep and this rides a cut): every
suite reading connections or Qwen, 389/389. CI runs the full suite.

### Per-Iteration Breakdown

Severity tags only where a review commit recorded one.

#### Iteration 1 (opus)
- [WARNING] the guide implied Kosmos installs Codex for Qwen; the server refuses instead. Fixed (e17ac070d).
- [CONCERN] an address that does not answer is still saved; now said. [NIT] Windows claim pinned to the page.

#### Iteration 2 (sonnet)
- No blocker or warning. Concerns taken: OpenAI offers the Codex install; a key to another computer needs https;
  a 404 answer is saved too (914b7f853).

#### Iteration 3 (opus)
- [BLOCKER] on main, from #6043: resolveBin('codex') is never present, so every Qwen add was refused; the route
  test's mock said yes to any name. Fixed with 'openai', a real-shaped mock and a no-Codex arm (d7f8ede46). The
  old call reds 8 of 9 route tests.

#### Iteration 4 (sonnet)
- No blocker, warning or concern. [NIT] one long guide sentence; left as is (accurate and pinned).
