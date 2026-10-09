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
