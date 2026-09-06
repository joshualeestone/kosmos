---
method: challenge-loop
branch: reactions-2255-deliver
diff_hash: c4aa9d7a3e877fb020614e75cc128f36108f7da1b9bc3321074328ad57ec04e4
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (round 3 verified both prior fixes correct and found no behavior
defect; its one finding was a stale test-mirror, fixed).
**Method:** fresh blind CTO-lens reviewers, each spawned without the authoring
agent's context.

reactions-2255-deliver ships the deliberately-deferred agent-DELIVERY half of emoji
reactions (kosmos#2255). The operator/user side merged as #2300; the /api/react route
and messages.react() engine (toggle, membership gate, operator-sentinel guard) are
already in main. This adds the agent's surface onto them: `kosmos react <project>
<postId> <emoji>` (install/kosmos), post ids surfaced in `kosmos room` (server.js
?as=text renderer), and one agent instruction line (engine/defaults.js, doctrine 8->9).

### Round 1 (blind, all risk areas)

[correctness] No blockers. Two NITs, both fixed:

- **[NIT] Comment overclaimed "anchored".** cmd_react's response-parsing comment said
  the globs were anchored, but they led with `*`. FIXED by anchoring them on the leading
  keys (`'{"ok":true,"op":"add"'*` etc.).
- **[NIT] Lost-response + toggle double-toggle.** cmd_react collapsed every curl failure
  into "could not reach", inviting a retry; because /api/react TOGGLES, a response lost
  after the server acted would leave the reaction applied and a retry would take it back
  off. FIXED by distinguishing curl exit 28 (timeout), mirroring cmd_post.

[security] Round 1 verified clean, with evidence: the request body shape matches the
route; the sender cannot be forged (identity from from_pane -> resolveSender ->
sessionName, body operator/from ignored, proven by the %9999 spoof test); the board token
is off-argv; the `[id]` prefix attaches only to post rows and breaks no other ?as=text
reader; wiring is complete (dispatch + both help lists + --help recognition).

### Round 2 (convergence attempt) -- did NOT converge

- **[correctness][BLOCKER] The round-1 NIT-2 fix introduced a set -e silent-abort.** The
  fix had replaced `body=$(...) || { fail }` with a bare `body=$(...); rc=$?`. Under the
  shebang's /bin/bash 3.2 and `set -euo pipefail`, a failing command substitution in a
  bare assignment aborts the whole process at that line, so on any curl failure
  `kosmos react` printed nothing and exited with curl's raw code -- both the exit-28 and
  unreachable messages dead, and the previously-working unreachable message regressed to
  a silent abort. Measured against the real CLI: a destroyed socket gave exit 52 and empty
  output. FIXED with `rc=0; body=$(...) || rc=$?` (commit 0dd824d5). Added a regression
  guard that drives a real curl failure (the stub destroys the socket after healthy()
  passes) and asserts the CLI speaks and exits non-zero -- the path a response-stub cannot
  see. I had independently found and fixed this same bug before round 2 reported; round 2
  corroborated it with its own bash-3.2 measurement.
- **[test-coverage][NIT] A vacuous "anchor guard" test.** The test I added for the round-1
  anchoring passed vacuously: the bait `because` is a JSON string, so sendJson escapes its
  quotes and both the anchored and unanchored globs fall through to the refusal arm -- the
  test could not fail on the anchoring, and the injection was never reachable. FIXED by
  removing it (commit 690351d2); the anchored globs keep genuine coverage from the
  add/remove tests (real success bodies), and the comment now states it is a readability
  key-order split, not an injection defence.
- **[efficiency] Surfaced (pre-existing, out of scope):** cmd_post has the identical bare
  `body=$(...); rc=$?` pattern, so its "still delivering, do not re-post" branch is dead
  the same way. Filed as kosmos#2321 rather than widening this PR.

### Round 3 (convergence) on the fixed state -- CONVERGED

[correctness] Round 3 verified both prior fixes correct on HEAD, independently proving the
set -e mechanism on /bin/bash 3.2.57 (the bare form aborts before the rc check; the fixed
`|| rc=$?` reaches it and returns 0), and confirming the exit-28-vs-other distinction is
real (kosmos_curl propagates curl's code in both token branches). It confirmed no coverage
was lost by removing the vacuous test (the add/remove tests still pin the anchored globs
against real-key-order bodies). It re-scanned the body shape, sender/membership/operator
security, the `[id]` prefix scope, wiring, and the doctrine bump with fresh eyes -- all
correct.

- **[test-coverage][NIT] Stale byte-for-byte mirror.** engine/room-clock-1895.test.js has a
  local postLine helper documented as the server's post line "byte for byte", used to
  exercise the zone render and the to:[] -> "the room" fallback. server.js's ?as=text
  renderer now prefixes each post with `[id]`, but the mirror was not updated, so it went
  silently green against a format it no longer matches -- exactly the drift #1895 exists to
  catch. FIXED (commit 2afffb0e): added `[id]` to the helper, gave the fixtures ids, updated
  the expected strings, mirroring the server-driving update in server.projects.test.js.

Converged at 3 iterations: the sole blocker (round 2) is fixed and independently verified,
and round 3 found no behavior defect -- only the test-fidelity drift above, now fixed. A
fourth round would review only a mechanical test-copy alignment.

### Validation

- [correctness] Full node suite GREEN on the final commit (canonical tools/run-tests.sh,
  exit 0).
- [test-coverage] cli.react-2255.test.js: the CLI POSTs the right body, presents/omits the
  board token, reports add/toggle-off/refusal, refuses a missing arg without calling the
  route, and (the set -e guard) reports a real curl failure with a non-zero exit instead of
  a silent abort.
- [test-coverage] server.projects.test.js: the ?as=text row carries the post id in brackets
  and that id equals the JSON post id an agent reacts against.
- [test-coverage] engine/defaults.test.js: doctrine fingerprint re-pinned for
  DOCTRINE_VERSION 9. No web/ file in the diff, so no browser-check is required.
