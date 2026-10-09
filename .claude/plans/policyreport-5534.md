# policyreport-5534: report the applied policy version back to the company (E0.5 slice 2)

Card: kosmos#5534. Slice 1 (kosmos PR #5726) made an enrolled board apply the signed company policy. This slice tells the
company which version each computer applied, and whether it refused one the company sent.

Finished means: an admin opening a member in the console sees the policy version that member's computer applied (or
that it refused one), and nothing about the policy is sent or stored for a member until they accept consent words naming it.

## Coordinator (kosmos-relay, branch policyreport-5534)
- consent() reports gains: "which version of your company's policy this Kosmos has applied, and whether it refused one your
  company sent". That changes consent_hash, so every member accepts the words again before a board sends it (contract v1.4:
  a rollup under old words is refused org_consent_changed, and the board stops until the person accepts).
- CONSENT_NAMES_POLICY (true, pinned by a test to the words). RollupReq gains policyVersion (1..2^53-1) and policyRefused;
  stored on every send. Under words not naming it, a rollup carrying either is refused (as usage is).
- orgconsole instance carries policyVersion and policyRefused; console.html policyVersionText fills the existing row.

## Board (kosmos, branch policyreport-5534, stacked on policyapply-5534 / PR #5726)
- orgenroll acceptedConsent gains policyConsented (whole word "policy" in the accepted report lines, read each time).
- orgrollup: policyVersion is a whole number or null (was a cleaned string), policyRefused a boolean; the tick reads
  orgpolicy.refresh() only under policyConsented, else sends null/false.

## Decisions
- Wording follows Josh 2026-10-09 08:41 (the company owns the work computer): the line states plainly what is reported.
  Rejected "refused a newer one": the board also refuses older, re-signed and tampered bundles.
- A refusal is a boolean, not the reason: the reason is board prose and would be a new free-text field to the company.
- Deploy order does not matter: an old coordinator ignores the fields; a board sends them only under the new words.

## Review decisions (rounds 1-6)
- Released boards 0.7.33 to 0.7.35 always send policyVersion null with no policyRefused: the coordinator reads that as
  "not reported" (round 3 BLOCKER: refusing it would have stopped every report from those boards after re-consent).
- Both fields together otherwise; a send without them keeps the stored values, but only for the same world.
- policyReported tells "none applied" from "never reported"; the console says "None applied" or Unavailable.
- A refusal is something new the company sent: the policy in force merely expired (signature checked) is `stale`, a
  fault on this computer (failed save, no pinned key) is `local`; neither is reported as refused.
- The board gates on the line naming the version ("version of your company's policy"), not the bare word, because the
  update line also mentions the policy (round 5). The coordinator constant is pinned to the same phrase.
- A failed policy read repeats the last values sent, so a passing fault does not make two change sends.
- Known limits, decided: refusals applyPolicy makes before saving (over 64 KB, another company's) are not reported; a
  working coordinator never sends them. A newer bundle left unapplied by a failed save, then expired, reads as refused.
  The coordinator checks the version range, not that the company ever saved it (the board is the member's own Mac).
- Deploy: the coordinator change ships with the next relay deploy; members accept the new words once.
