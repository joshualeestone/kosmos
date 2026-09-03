---
pre_challenge: true
method: challenge-loop
branch: phonehome-defaults-2013
diff_hash: d1ad4189950e8fbf2f67718420000411092786062344b9de8fbc319dc186bd8a
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T15:42:11Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found zero BLOCKER/WARNING/CONVENTION/NIT, verified by running)
**Total findings:** 1 BLOCKER-class fail-safe defect + 5 WARNING/contract + 2 NIT
**Fixed:** all actionable | **Deferred/documented:** the remote.js twin (documented, no behaviour change) + 1 plan NIT (accurate for a human reader) | **Asked:** 0

kosmos#2013: flip the two safe, decided phone-home/autonomy settings to default ON
(heartbeat, autohandoff), and deliberately HOLD the two external-emission ones
(notify, ping, #2020). Files: engine/heartbeat-setting.js + .test.js,
engine/autohandoff.js + .test.js, engine/remote.js (comment-only),
server.heartbeat-1722.test.js, server.test.js, web.autohandoff-1724.test.js,
web.heartbeat-1722.test.js, web/index.html, and the plan.

### Per-Iteration Breakdown

#### Iteration 1 (prior session)
**New findings:** the server-level heartbeat default test asserted the old off-default;
remote's comment was wrong about the default direction.
- [WARNING] a server-level heartbeat default test still asserted OFF --> FIXED, commit 3defcf35
- [NIT] remote.js comment corrected --> FIXED, commit 3defcf35

#### Iteration 2 (prior session)
**New findings:** a second missed default contract, the corrupt-config sign-off, frontend drift.
- [WARNING] server.test.js #1724 default contract still asserted OFF --> FIXED, commit 82ef0592
- [WARNING] the corrupt-config direction (heartbeat OFF / autohandoff ON) needed stating --> FIXED, 82ef0592
- [WARNING] frontend fallback default drifted from the engine default --> FIXED, 82ef0592

#### Iteration 3 (prior session)
**New findings:** USER-VISIBLE Settings hints still read "Off by default".
- [WARNING] web/index.html Settings hints (~9631, ~9668) still said "Off by default" for the
  two flipped controls (prose a code-pattern grep missed) --> FIXED, commit e85066eb
- [NIT] 5 stale comments corrected --> FIXED, e85066eb

#### Iteration 4 (blind agent)
**New findings:** 1 fail-safe defect, 1 plan NIT.
- [WARNING/fail-safe] engine/heartbeat-setting.js:57 -- `typeof [] === 'object'`, so a JSON
  ARRAY config passed the corrupt guard and `[].on` -> the ON default: a corrupt config
  turned INTO phoning home, the one direction the fail-safe path must never take, and a
  behaviour CHANGE from the old safe on:false. --> FIXED (reject arrays / any non-plain-object
  JSON via `Array.isArray`; new array-shape test with an object control), commit 5c56a3d0
- [NIT] .claude/plans -- the plan said remote.js "default is ON"; it stays OFF (the comment
  records why the paid relay must never auto-enable) --> FIXED (plan corrected)

#### Iteration 5 (blind agent)
**New findings:** 2 WARNINGs, 1 NIT.
- [WARNING] engine/heartbeat-setting.test.js -- only the array corrupt shape was pinned; the
  scalar/null legs fell to OFF correctly (verified) but were untested, so a future edit to a
  guard leg could silently regress them --> FIXED (a test iterating null/number/string/bool/0/""
  as valid JSON, each asserted OFF + ok:false), commit 3b350aa3
- [WARNING] engine/remote.js:140 -- the identical `typeof []==='object'` twin, but NOT a bug
  here: remote reads `on: parsed.on === true` (explicit-true, never defaulted), so an array
  reads off (remote's safe value). Adding Array.isArray would flip `ok` for a corrupt array,
  a behaviour change to functionally-untouched code --> DOCUMENTED (a comment recording why
  the twin is array-safe without a guard, so the next reviewer sees it was evaluated, not
  missed), commit 3b350aa3. No behaviour change.
- [NIT] plan provenance (the 08-26 / 09-03 ruling conflict) is not verifiable by a blind code
  reviewer --> NO ACTION: accurate for the human reviewer/Josh who can verify it, and the code
  confirms notify/ping are untouched either way.

#### Iteration 6 (blind agent) -- CONVERGED
**New findings:** 0 in every category, verified by running (57 pass across the engine/server/web
targeted suites; 253 pass in server.test.js). The only em dashes in web/index.html predate the
branch and are in code comments, out of scope.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | server test | heartbeat default test asserted OFF | FIXED | 3defcf35 |
| 2 | 1 | NIT | remote.js | comment wrong about default | FIXED | 3defcf35 |
| 3 | 2 | WARNING | server.test.js | #1724 default contract asserted OFF | FIXED | 82ef0592 |
| 4 | 2 | WARNING | engine | corrupt-config sign-off (hb OFF / ah ON) | FIXED | 82ef0592 |
| 5 | 2 | WARNING | web/index.html | frontend fallback drifted from engine default | FIXED | 82ef0592 |
| 6 | 3 | WARNING | web/index.html | Settings hints still said "Off by default" | FIXED | e85066eb |
| 7 | 3 | NIT | web/index.html | 5 stale comments | FIXED | e85066eb |
| 8 | 4 | WARNING | engine/heartbeat-setting.js:57 | JSON array bypassed corrupt->off fail-safe | FIXED | 5c56a3d0 |
| 9 | 4 | NIT | plan | remote.js default direction misdescribed | FIXED | plan |
| 10 | 5 | WARNING | heartbeat-setting.test.js | scalar/null corrupt legs untested | FIXED | 3b350aa3 |
| 11 | 5 | WARNING | engine/remote.js:140 | typeof-array twin (not a bug; safe via ===true) | DOCUMENTED | 3b350aa3 |
| 12 | 5 | NIT | plan | provenance unverifiable by a blind reviewer | NO ACTION | accurate for humans |

### NITs (non-blocking, for follow-up)
- engine/remote.js still carries the `typeof []==='object'` shape. It is safe TODAY (explicit
  `=== true`, off by default), but if remote ever adopts an on-by-default it would become the
  live bug heartbeat just fixed. Documented in-code; worth an Array.isArray hardening if that
  default ever changes.

### Strengths (across iterations)
- The fail-safe contract is now pinned in both directions and across every guard leg: heartbeat
  corrupt (unparseable, array, scalar, null) -> OFF; autohandoff corrupt -> ON (deliberate);
  each with a discriminating control so the assertions cannot pass vacuously.
- Single source of truth confirmed: server consumption routes through
  heartbeatSetting.read() / autohandoff.settingFrom(); no duplicate defaulting elsewhere.
- notify.js / ping.js are byte-identical to origin/main (the HOLD, #2020); remote.js is
  comment-only and stays off by default.
- No user-facing "Off by default" prose remains for the two flipped settings.
