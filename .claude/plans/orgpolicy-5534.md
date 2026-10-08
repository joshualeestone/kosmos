# orgpolicy-5534: the board applies the signed company policy (Enterprise E0.5, board side, slice 1)

Addresses #5534 (part of #5529). The card stays open: the enrollment gate (E0.2), version report (E0.3) and console
(E0.4) are later slices.

## Finished looks like
An enrolled board's coordinator-signed policy bundle (KST1, typ org_policy, at <tunnel state>/org_policy.kst) is
verified on the board against the pinned coordinator key; a tampered, foreign-signed, expired, older or malformed
bundle is refused and the last good one stays in force; creating an agent, switching its provider or switching its
model onto something the policy does not allow is refused with the policy's sentence; with no policy nothing changes.

## Built
- engine/kst1.js: verify(token, pinned, typ, now) per kosmos-relay docs/token-format.md. Never throws.
- engine/orgpolicy.js: refresh() (verify, shape check, no rollback, keep last good, atomic write of
  <store>/org-policy-applied.json), current(), allows({provider, model}) (model may be several names; any listed
  allows it).
- engine/create.js: createAgentInner, setProvider and setModel ask allows() before writing anything; an unreadable
  record is no policy.
- Tests: engine/orgpolicy-5534.test.js (8, one: a bundle written since applies with no refresh call), create.test.js '#5534' (create, provider switch, model create, model
  switch, controls; red with the setModel gate removed).

## Decided (also on the card)
- Names: the board's provider ids; models by key or full id.
- Running agents are never stopped and keep relaunching (nothing bricked).
- antigravity is its own id (strict direction).
- Weakest premise: admins may expect a dropped provider to stop existing agents at restart.

## Not in this slice
Enrollment gate (E0.2 #5531), version report (E0.3), AI policy text via policy.js, the console (E0.4 #5533), the
fetch on start and daily (the tunnel's job: it writes the bundle). The board needs no timer: allows() re-reads and
re-verifies the bundle each time it is asked (inForce), so a bundle written since applies at the next create or switch.

## Review log
