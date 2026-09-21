---
method: challenge-loop
branch: fix-3326-reauth-strand
diff_hash: cf46584ee587e2b9b909e3d335363fc265597f7e0f79980243fc8e7375e3a74f
converged: true
---

# Challenge loop: #3326 reauth-strand regression fix (the 0.6.85 gate)

Adversarial self-review of gating the sign-up forced reauth on real liveness. Two iterations;
converged, no BLOCKERs. This is my own regression, so reviewed hard.

#### Iteration 1

[WARNING] The fix adds a real `claude -p` liveness probe to the sign-up path — latency regression?
No: it is gated on `fileConnected` (only when the file already claims connected — the shallow case
#3326 targeted), a brand-new user skips it entirely, and the probe is non-interactive and LIGHTER
than the interactive `claude auth login` it replaces. So for a new user: no new cost; for a
connected user: less than #3326's forced login. Acceptable.

[WARNING] UNKNOWN → `liveVerified:true` (fail open) — is marking a credential verified-live when the
probe could not confirm it a re-introduction of the shallow-connected bug? It follows create.js's own
#1315/#1903 doctrine (refuse/force ONLY on a positively-dead credential; fail open otherwise), and
agent-creation's #1903 live gate is the BACKSTOP — a credential that fails open here but is actually
dead is still caught before an agent runs on it. The alternative (force reauth on UNKNOWN) would
strand a signed-in user on a transient network blip. Confirmed-intentional, backstopped.

[STRENGTH] The decision is EXTRACTED into a pure `reauthDecision` and unit-tested (5 cases), directly
asserting the regression: file-connected + LIVE → effectiveReauth:false (no forced login, no strand).
The #3326 guard it replaces was source-level ("the default call forwards reauth") and by construction
could not see the OVER-forcing that caused the regression — a real behavioural test now can.

#### Iteration 2

[WARNING] Does the client accepting `st.liveVerified` re-open #3326's shallow-connected bug (a stale
credential finishing sign-up)? No: `liveVerified` is set by the SERVER only when the REAL probe did
NOT return NONE. A shallow-file-connected credential that is actually DEAD → probe NONE →
effectiveReauth:true → connect.start does NOT short-circuit → no liveVerified → the login is forced,
exactly as #3326 intended. So a dead credential still cannot finish sign-up. The intent is preserved;
only the OVER-forcing on a LIVE credential is removed.

[WARNING] The accountDir "Sign in again" path is left untouched — correct? Yes. That path is a
DELIBERATE user-requested repair (they clicked "Sign in again" to fix an expired login), so it should
force. The regression is only the DEFAULT sign-up auto-forcing on everyone. The fix scopes to the
default call only.

[NIT] `st.liveVerified = true` mutates the connect.start result object — harmless (adds one field to
the JSON the route already sends).

Converged: no BLOCKERs. server.test.js 320/320 (incl. the reauthDecision regression test), connect
web 89/89, engine connect 75 + create 36 green. 🛑 The end-to-end auth CARRY cannot be unit-tested —
a REAL-MAC verify (a live-credentialed sign-up NOT force-re-logging-in + the spawned Claude agent
talking) is the 0.6.85 gate, the same real-tester gate the whole hold is about.
