---
pre_challenge: true
method: challenge-loop
branch: staging-agent-online-2129
diff_hash: 4700af1d07ac692af2bf28a23412a26a061cbb8e78df68b16c7cb028fcc82ca5
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T18:47:24Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (no new BLOCKER/WARNING/CONVENTION at iteration 7; the one residual WARNING is the documented weakest premise, mitigated behind forceable-only exit 2)
**Total findings:** 1 BLOCKER (x2 sites), ~7 WARNINGs, ~7 NITs
**Fixed:** most | **Deferred:** 3 (all documented) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] board JSON contract not live-tested; a field mismatch -> false refusal --> FIXED (self-diagnosing "never appeared" timeout) + residual is the documented weakest premise
- [WARNING] gate needs both Claude+OpenAI connected -> HOLDs a Claude-only board --> DEFERRED (by design; forceable)
- [NIT] unused local rc; PORT not numeric-validated; agent-gate stub no port-forward assert --> FIXED (dropped rc; numeric PORT guard; port-forward test arm)

#### Iteration 2
- [WARNING] KOSMOS_AGENT_ONLINE_MAX_EXISTING unvalidated -> a non-numeric value short-circuits the fleet-safety guard (would spawn test agents on a live fleet) --> FIXED (numeric guard, safe default 2)
- [WARNING] exit-1 vs exit-2 asymmetry: never-appeared / unexpected-400 are cannot-tell, not proven wedge --> FIXED (reclassified to exit 2, forceable; a real sign-in 400 and appeared-but-not-online stay exit 1)

#### Iteration 3 (a real BLOCKER)
- [BLOCKER] connected-account parser keyed on conn.connected===true / badge==="connected" -- fields GET /api/accounts NEVER emits (real shape: connection.state==="connected", subscription.js STATE.CONNECTED). On a real board the gate would ALWAYS exit 2 before creating anything -> silently useless. --> FIXED (key on connection.state + the Claude live badges)
- [BLOCKER] fixture hand-built the wrong shape, so all arms passed green while the parser was dead ("a fixture is not a raw capture") --> FIXED (rebuilt the fixture to the real /api/accounts + top-level /api/status shapes; added a signed-out red-capable arm)
- [NIT] case-sensitive trust/sign-in matches --> FIXED (case-insensitive via tr; mixed-case arm)

#### Iteration 4
- [WARNING] fleet guard fails OPEN on an unparseable /api/status (N_EXISTING default 0) --> FIXED (fail CLOSED via an ERR sentinel + numeric validate)
- [NIT] api_post retried a non-idempotent POST (duplicate agent risk) --> FIXED (no retry; lost response -> cannot-tell)
- [WARNING] unquoted heredoc feeding node --> FIXED (converted to printf | node for self-evident injection-safety, consistent with the other parses)

#### Iteration 5 (+ Splinter OpenAI-arm ruling)
- Splinter ruling: aggregate CENTERED ON THE CLAUDE ARM; new exit 3 (Claude online, OpenAI/Codex failed -> surface + route, forceable, never auto-hold). promote-channel.sh handles 3.
- [WARNING] two-consecutive-online: guard a transient idle before a trust wedge --> FIXED
- [NIT] POLL_SECS/POLL_INT unvalidated (a non-numeric/zero POLL_INT infinite-loops) --> FIXED
- [WARNING] trust-wedge/fail-closed arms not red-capable (only assert exit code) --> FIXED (--expect message assertions)

#### Iteration 6
- [WARNING] the two-consecutive-online guard is UNTESTED/vacuous (fixed-state fixture) --> FIXED (a transitioning fixture: flip-wedge proves the guard; verified it fails under a weakened 1-poll guard)
- [WARNING] timeout-boundary: a slow/flapping online read as exit 1 (non-forceable) --> FIXED (ever_online -> exit 2, forceable; idle-once arm proves it)

#### Iteration 7 (CONVERGED)
- [WARNING] a Claude wedge that shows idle->stopped (not needs_you) reads as exit 2 not 1 --> DEFERRED (the documented weakest premise; forceable-only exit 2, conscious acceptance; a real #2129 trust wedge surfaces as needs_you and IS caught)
- [NIT] create-success fixture nested under `result`; real board is top-level {outcome,name} --> FIXED (faithful shape; the gate's ||j.name fallback now non-vacuous)
- [NIT] a non-trust needs_you labeled "did not come online" rather than "wedge" --> DEFERRED (cosmetic; identical exit 1; supervisors launch --dangerously-skip-permissions)

### Deferred (all documented)
- both-providers-required HOLD on a Claude-only board (forceable) -- by design per Splinter.
- a Claude wedge that surfaces only as idle->stopped -> exit 2 (forceable) -- the documented weakest premise; the primary #2129 signal (needs_you trust card) is caught at exit 1.
- non-trust needs_you labeling -- cosmetic; identical promote outcome.

### Strengths (across iterations)
- Fail-closed everywhere: the only route to exit 0 is a card matched on sessionName reaching idle/working on TWO consecutive polls; every unparseable/absent/busy/wrong-shape/wedge/auth path funnels to 1 or 2; cannot-tell never reads as a pass.
- exit-code aggregation centered on the Claude arm is airtight (1>2, then OPENAI 0/1->3/2->2); no (CLAUDE_RC,OPENAI_RC) pair lets a bad build read as 0 or 3.
- Security: token off argv (mode-600 -H @file); board bodies via printf|node (no shell expansion); POST body via node JSON.stringify.
- Fixtures verified against product source shapes (connection.state; top-level status card; top-level create result); red-capable via the KOSMOS_AOC_CURL DI seam.
- promote-channel.sh mirrors the experience gate's forceability exactly (1 never forceable; 2/3 HOLD forceable; unforced 1/2/3 never promote).
