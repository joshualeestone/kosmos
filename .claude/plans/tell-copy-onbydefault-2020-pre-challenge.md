---
pre_challenge: true
method: challenge-loop
branch: tell-copy-onbydefault-2020
diff_hash: d960dc72fb861a4201eac039b7a078a2d60eb417b92acce01a0ca71513133d93
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T02:39:30Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 2 | **Deferred:** 0 | **Asked:** 0

Card: kosmos#2020 (Splinter side-task). The Settings create-ping OPT-OUT row read
"Off by default" while the ping now defaults ON (`engine/ping.js:75`). Corrected
the copy to "On by default; this switch turns it off", updated the comment, added
a browser-check guard, and fixed two stale sibling comments.

### Validation note

The comprehensive full node suite runs on CI; locally green on the affected
surfaces: server.test.js (265), engine/notify.test.js (6), web.create-tell.test.js
(11), web.switch-markup.test.js (2), web.reply-where.test.js (10),
web.feedback-switch-2037.test.js (5). Render evidence: the render-optout-403-2020
page-layer check (its new default-ON copy assertion + the existing tell-toggle
ON-state assertion) run via tools/browser-checks.sh once the shared box was clear.

### Per-Iteration Breakdown

#### Iteration 1 (blind review)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT.
- [WARNING] server.test.js -- a stale sibling comment still claimed create-ping is
  "OFF by default (flip held for Josh)" --> FIXED: updated to "ping ON, notify OFF".
- [NIT] engine/notify.test.js -- a history comment lagged its own (already-correct)
  assertions with the same stale claim --> FIXED.
- 2 STRENGTHs: the copy fix is accurate and correctly scoped (only `#tell-row`, notify
  untouched); the browser-check assertion is sound and discriminating (fails on the
  old copy, passes on the new; reads the descriptive `.dhint`, not the status line).

#### Iteration 2 (blind review)
**New findings:** 0 -- "No issues found." 4 STRENGTHs independently confirming: the
fix is truthful (ping.js:75 ENOENT->on:true); the browser-check guard is correct and
discriminating; scope is clean (notify row keeps its correct "Off by default", called
out in the comment); and NO remaining stale create-ping "off by default" claim exists
anywhere (checked web/index.html, docs/browser-checks, and the test files -- the other
"Off by default" hits are the notify row, the eng-mode row, and a gate-log comment,
all correct).
**Converged.**

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | server.test.js | stale sibling comment ("ping off by default, flip held") | FIXED | 16df5583 |
| 2 | 1 | NIT | engine/notify.test.js | history comment lags its assertions | FIXED | 16df5583 |

### Strengths (across all iterations)
- The copy is now truthful and the wording swap the #2020 comment predicted is done.
- Only create-ping surfaces changed; the genuinely-OFF notify row is untouched and
  explicitly called out ("do not sweep it with this one").
- The browser-check guard (a default-ON switch's copy must not say "Off by default")
  would have caught this bug and prevents recurrence, keyed to the same DEFAULT_ON
  map the check already uses.
- The sibling sweep is complete: no other stale claim about create-ping remains.
