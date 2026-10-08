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
- engine/create.js: policyAllows(provider, model) (key or full id; no model = the provider default); createAgentInner,
  setProvider and setModel ask it before writing anything. engine/discover.js connect and engine/worldstarts.js
  firstStartOfImport ask it too (both create agents); register.repair does not (it re-registers existing ones).
- Tests: engine/orgpolicy-5534.test.js (7, one: a bundle written since applies with no refresh call), create.test.js '#5534' (create, provider switch, model create, model
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
### Review 1 (opus): 2 BLOCKERs, 4 WARNINGs, 3 CONVENTIONs
- BLOCKER fixed: connecting a folder and importing from another Kosmos created agents without asking the policy. Both ask now; tests in discover.adopt.test.js and worldstarts.test.js, each red with its gate removed.
- BLOCKER fixed in part: the rollback guard compared only within the applied org, so another org's bundle in between reopened an older one. The applied record keeps the highest version per org (test, red without it). Deleting the record still reopens it: stated in the header as what this is not trusted for; closing it is E0.3 (the coordinator checks the reported version).
- WARNING fixed: a model list was dodged by naming no model. No model now means the provider default (create.policyAllows), and a vendor default no list can name is refused under a list. Tests: create with no model under a list without the default refused; red with the default lookup removed.
- WARNING documented: the policy is per Kosmos on a Mac, as enrollment is (header).
- WARNING documented: no way out of an applied policy until E0.2 (leaving a company); header.
- WARNING: the coordinator side does not exist yet; the payload now uses iat as docs/token-format.md does. The token-format section for org_policy is for the relay PR (noted on the card).
- CONVENTION fixed: create by key when listed by full id (test); stateDir comment says it is a copy and why; header no longer says LAUNCHED.
- NITs left: applied_at uses the clock not the injected now; a failed rename leaves a .tmp; the "never throws" fallbacks.
- Focused: orgpolicy 7/7, discover.adopt 29/29, worldstarts 48/48, create 224/224 (23:56 CDT 2026-10-07).
