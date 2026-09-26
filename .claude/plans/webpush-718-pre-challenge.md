---
pre_challenge: true
method: challenge-loop
branch: webpush-718
diff_hash: aad44dbd1b7211abdf0b672c802e4d22b7cf6a2994f3e3b7e6ef51616e42f183
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T20:20:20Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (6.0 passed; six blind reviewer passes)
**Converged:** Yes, at iteration 6 on HEAD 6341c129
**Total findings:** 21 (0 BLOCKERs, 14 WARNINGs, 7 CONVENTIONs, plus NITs)
**Fixed:** 18 | **Deferred:** 3 | **Asked (awaiting user):** 0

The branch changed direction twice during the loop (Josh: apps only, 14:33; Liu Kang:
ship hidden behind a gate), and each change was reviewed by the next blind pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs
**Self-generated:** 0
- [WARNING] engine/phonenotify.js : caps counted in characters, coordinator counts UTF-8 bytes --> FIXED (capBytes; test + control)
- [WARNING] engine/phonenotify.js : a dead token could never be replaced; concurrent turn-ons --> FIXED (always re-mint, single flight; test + control)
- [WARNING] engine/remote.js : an old tunnel's error blamed Kosmos+ --> FIXED ("needs an update"; test)
- [WARNING] server.js : a busy session could buzz on every permission prompt --> FIXED (5 minute per-agent cooldown; test + two controls)
- [CONVENTION] plan file carried the superseded design --> FIXED (folded into History)
- [CONVENTION] render-pwa-installable-718 described a removed flow --> FIXED
- NITs taken: carried-forward project, honest on-but-disconnected control, one URL join

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 0
- [WARNING] server.js : race between read of prior state and record --> DEFERRED: read, record and happened() run in one synchronous callback with no await between them (checked at the code), so two requests cannot interleave

#### Iteration 3
**Reviewer model:** opus (after the apps-only change)
**New findings:** 5 WARNINGs, 1 CONVENTION
**Self-generated:** 1 (the apps-only copy)
- [WARNING] a hung tunnel hung every later turn-on --> FIXED (mac-request timeout kills the child; test with timing + control)
- [WARNING] turn-off during a turn-on could end on --> FIXED (turnOff waits; test + control)
- [WARNING] failed sends were silent --> FIXED (logged, never the token)
- [WARNING] a long session name could collide event ids --> FIXED (timestamp first; test + control)
- [WARNING] the Settings step points at an app that cannot receive yet --> DEFERRED then RESOLVED by Liu Kang's ship-gate ruling (built after iteration 5)
- [CONVENTION] CLAUDE.md row described option C --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING
- [WARNING] render-pwa-installable-718 items (2) and (4) still said gated --> FIXED (armed in render-push-718)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 4 CONVENTIONs
- [WARNING] the hung-tunnel fixture added ~29 s to every suite --> FIXED (exec sleep; file now runs in 3 s)
- [WARNING] ship order (duplicate of iteration 3) --> DEFERRED as a duplicate; ruled by Liu Kang, gate built
- [WARNING] outbox-delivered replies do not notify --> DEFERRED by design and written at the call site: the person opened that Kosmos, so a buzz adds nothing
- [CONVENTION] false "one derivation" comment --> FIXED
- [CONVENTION] constants without a why --> FIXED
- [CONVENTION] header gave the wrong reason for minting through the tunnel --> FIXED
- [CONVENTION] commit subjects with special characters --> FIXED (message-only rewrite of nine subjects; trees verified identical)

#### Iteration 6
**Reviewer model:** sonnet (reviewed HEAD 6341c129, including the ship gate)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged.**

### Evidence
- Full suite on 6341c129: 8762 tests, 0 failed (validation helper passed, hash aad44dbd1b72). A first run was stopped by the #3011 LaunchAgents guard: com.kosmos.agent.johnnycage.plist, a real agent's, was modified at 15:10:45 during the run by the live board; the rerun alone was clean.
- Local end to end on 6341c129 (gate opened through the test seam): 13/13, FCM `push delivered ... status=201`, the tap target is the Mac's address, the words never left, nothing sent while off.
- Ship gate: server.phonenotify-gate-718.test.js, closed arms plus a control; two controls (constant opened, sender ignoring the gate) turned it red.

### NITs (not taken)
- server.js /api/phone-notify comment does not mention `available`
- the section comment does not mention `hidden`
- the cooldown map is pruned only past 500 entries
- the browser check does not click the toggle

### Strengths
- Off by default proven by behaviour with controls, four off arms plus the ship gate
- Token never returned, never logged, stdin not argv, 0600
- Byte-accurate caps, fail-closed state reads, serialized turn-on and turn-off
