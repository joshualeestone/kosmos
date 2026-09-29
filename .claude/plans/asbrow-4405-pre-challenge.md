---
pre_challenge: true
method: challenge-loop
branch: asbrow-4405
diff_hash: 9f3b12180530e24d426331123893b8e1afd59acadf6ccf492823a9e99431650a
subdir_audit: passed
timestamp: 2026-09-28T22:05:26Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, blind reviewers alternating opus (odd) and sonnet (even).
**Converged:** Yes. Iteration 8 raised one new WARNING, deferred below with its reason after reading the code; nothing else new.
**6c-bis provenance:** not measured.

## Ledger

### Iteration 1 (opus)
- [WARNING] web/index.html asbSwitchShowsOn: switch read OFF while the setting was ON. FIXED: the switch shows the stored setting (`ASB.setting.on === true`).
- [WARNING] web/index.html: `await asbFind()` returned early while a tick's lookup ran, so a just-made guide was missed. FIXED: `asbFindNow()` waits out `ASB.finding`.
- [WARNING] web/index.html no-model line promised the guide "will appear" for a deleted guide. FIXED: copy and path changed; a removed guide is restored by switching ON.
- [WARNING] server.js: no way to record an explicit OFF while no guide exists. FIXED by the same switch change.
- [WARNING] engine/setup-assistant.js: `explicit` skipped `createdHere`. FIXED: explicit skips only the arm gate and the retry wait; seeded and createdHere stand.
- [WARNING] server.js: new route branch had no server test. FIXED: server.asbrow-4405.test.js (real server).
- [WARNING] server.js: explicit try skips the retry wait. DEFERRED: it runs only on a person's click, one at a time behind the page latch, and the person asked for exactly that try.
- [NIT] stale not-made message after a guide appears. FIXED in asbPaintSetting.
- [NIT] comment about a real person's state. FIXED (and names scrubbed per the #3071 guard).
- [NIT] ensureGuide header sentences. FIXED.
- [NIT] loose /api/settings position check in the wiring guard. FIXED: route matched by its `pathname === '/api/settings' && req.method === 'POST'` text.
- [NIT] stray blank lines. FIXED.

### Iteration 2 (sonnet)
- [WARNING] stale message cleanup only for model cases. FIXED: any not-made message clears once a guide exists (`dataset.notMade`).
- [WARNING] names-taken fell through to the generic line. FIXED: specific lines for names-taken, seeded, unclear, `because`.
- [NIT] tests reference later-declared helpers. Accepted as written (node:test runs after module evaluation); no change.

### Iteration 3 (opus)
- [BLOCKER] a removed guide is not re-made by switching ON against the real createAgent. FIXED: the removed branch calls `removal.restore(now.removed)`; tested on a real server.
- [WARNING] 'none' also covers an unparseable flag. FIXED: the create branch additionally requires `!setupAssistantSeeded()`.
- [WARNING] page dead end with no `guide` field. FIXED: explicit lines for every server state.
- [WARNING] switch and Set it up now guarded double clicks separately. FIXED: one `ASB.turning` latch disables both.
- [WARNING] latch reasons showed the generic line. FIXED with the specific lines.
- [NIT] "setup assistant" wording, plan state 3 claim, blank lines. FIXED.

### Iteration 4 (sonnet)
- [WARNING] guidestate does not record the new states. DEFERRED at the time; re-raised in iteration 8 (see there).
- [WARNING] restore has no single-flight guard. FIXED: a REFUSED restore counts as success when `setupGuideNow().ok` shows another request restored it.
- [NIT] renamed test missing its "#4405 IS" half. FIXED: the unreadable-flag-arms test.
- [NIT] refused restore got the generic line. FIXED: `because` passed through.
- [NIT] surface token list missing asb-row-who. FIXED.
- [NIT] bubble still says "Setup assistant". DEFERRED: out of this card's scope (the row copy is Josh's; the bubble copy is unchanged on main).

### Iteration 5 (opus)
- [WARNING] OFF-to-ON stopped confirming a remembered guide. FIXED: asbTurnOn confirms a remembered guide first.
- [WARNING] "Restart Kosmos" advice false. FIXED: copy changed.
- [WARNING] refused restore dropped `because`. FIXED.
- [WARNING] restore test accepted refused. FIXED: asserts 'restored' against the dry board.
- [NIT] OFF path not latched. FIXED.
- [NIT] explicit armed before the OFF check. FIXED: arms after the OFF check.
- [NIT] transient 'unchecked' message. Accepted: the line is honest for that state.

### Iteration 6 (sonnet)
- [WARNING] PARTIAL restore treated as success. FIXED: ok is RESTORED, or refused with the guide present.
- [NIT] forgetGoneGuide untested. Superseded: removed in iteration 7.
- [NIT] hardcoded guide names in copy. Accepted: mirrors an existing line; follow-up if the names change.

### Iteration 7 (opus)
- [WARNING] forgetGoneGuide treats EACCES as gone. FIXED by removing forgetGoneGuide entirely.
- [WARNING] record deleted before knowing a guide can be made. FIXED by the same removal.
- [WARNING] untested paths. FIXED: folder-gone now gives 'unclear' and leaves the record unchanged (tested).
- [NIT] ensureGuide doc, plan tests list, 'seeded' line. FIXED.

### Iteration 8 (sonnet)
- [WARNING] server.js /api/settings: refused-restore and 'unclear' outcomes do not call recordGuideOutcome. DEFERRED after reading engine/guidestate.js: guidestate records CREATE attempts and which gate stopped them. 'unclear' attempts nothing, and a restore is not a create; a successful restore IS recorded as seeded. Recording non-attempts would make the record claim a create was tried when none was.
- [NIT] ensureGuide doc run-on. Accepted.

## Validation
- Full validation helper on the final commit: validation-log PASSED hash=9f3b12180530 on 40c32475e, VAL_RC=0 AUDIT_RC=0 (node fail 0); browser checks render-assistant-bubble-3034 111/111, render-assistant-hosted-3660 107/107, render-help-tips-3574 pass, render-signin-visible-3892 174/174.
- Browser-check surface gate: override trailer names `render-signin-visible-3892.js` (the reused, unchanged `.linkish` class).

## Decided gaps
- No browser success-path arm and no refused/partial restore arm: test boards run AGENT_WORKFORCE_DRY_RUN=1, so create and restore write nothing to disk. The success path is covered on the real server test.

## Weakest premise
- That `removal.restore` of a removed guide is the right answer to "switch ON after deleting it", rather than making a new one. It is tested with a hand-made removed record on a dry board, not against a person's real removed guide.
