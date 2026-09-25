---
pre_challenge: true
method: challenge-loop
branch: assistant-bubble-3034
diff_hash: ebbe90ba3254dff27faa99779b7d111c65aa098393435752efa5b54de2f883c2
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T04:47:57Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13
**Converged:** Yes (iteration 10 had nothing at WARNING or above; iteration 11 reviewed the post-convergence merge,
trailers and avatar-pin change and found nothing at WARNING or above)

### Per-Iteration Breakdown

#### Iteration 1 - opus
- [BLOCKER] the guide was looked up once at boot, before a new install has one --> FIXED 67d88b6b (re-find with backoff; B1b)
- [WARNING] reply dot lit on load --> FIXED (baseline; B2); [WARNING] sends departed from sendTalk's clearing rules --> FIXED (B5b, B5c); [WARNING] silent Settings failure --> FIXED
#### Iteration 2 - sonnet
- [WARNING] folded reads never re-validated the guide; opening raced a stale name --> FIXED 60483d3a (confirm before every read and send; B10)
#### Iteration 3 - opus
- [WARNING] a 409 forgot the guide in a loop --> FIXED 29a77c65; [WARNING] one failed settings read hid it for the session --> FIXED (B12, B13)
#### Iteration 4 - sonnet
- [WARNING] fixtures used a display-cased name, not the production slug --> FIXED 8af92787; [WARNING] switch-on painted before confirming --> FIXED
#### Iteration 5 - opus
- [BLOCKER] every 409 kept the guide, including "not the guide's folder" (a taken name) --> FIXED 90332519 (refusal reasons; B14)
#### Iteration 6 - sonnet
- [WARNING] README row stale --> FIXED 0f2da23b
#### Iteration 7 - opus
- [WARNING] the Help box hid the Setup assistant switch when tips were unreadable --> FIXED b6d8ce1c (B16); [WARNING] a refused send's message was unseen --> FIXED
- MEASURED on screen: the bubble covered an agent page's Send button --> FIXED (asbLift; B15)
#### Iteration 8 - sonnet
- [WARNING] the lift had no cap on short windows --> FIXED 42c2bc6f (B17); [WARNING] the switch re-enabled mid-confirm --> FIXED
#### Iteration 9 - opus
- [BLOCKER] the guide matched by display name too, so the person's own "Josh" (josh-2) could be taken for it --> FIXED a03fefb9 (session name only; B2b)
- [WARNING] a refused send vanished unseen --> FIXED (B19); [WARNING] B17's panel arm could not fail --> FIXED 0e8c058d (B2b and B17 re-aimed after their negative controls passed)
#### Iteration 10 - sonnet
- No new actionable findings at WARNING or above. **Converged.**
#### Iteration 11 - opus (post-convergence merge, trailers, avatar pin)
- No findings at WARNING or above; [NIT] one trailer's wording.

#### Iteration 12 - sonnet (after CI red)
- CI's browser-checks went red: GET /api/setup-guide answered 404 with no guide, which the browser logs as a failed resource, failing other checks' "no page errors" arms. FIXED 6445f36d: no guide is 200 { ok: false, reason: 'none' } (B1 asserts no failed resource; fails with the 404 back, as does render-reactions-2255).
- [WARNING] a test title still said 404 --> FIXED 010efd74 (with a stale comment)
#### Iteration 13 - opus
- No findings at WARNING or above. [NIT] three stale wordings (a test title "(404)", a test comment, the POST page route's comment); left, as each would cost another full validation run.

### Declined
- The hosted no-guide chat (Renet's #3674): a separate follow-up PR; today it answers 501 on every install (on the card).

### Validation
Surface gate: trailers for render-consolidated-newagent-3053.js, render-agentdm-3414.js, render-help-tips-3574.js (all
run green unchanged). web.avatarver-2762 pin 20 -> 21 (the assistant's picture is versioned). Two contention reds
(tools.release-gate #1455 while Baron's install harness ran; engine/updating-988 at load 11 on 10 cores) each passed
alone repeatedly; final 6j PASSED on 010efd74's content (record hash ebbe90ba).
