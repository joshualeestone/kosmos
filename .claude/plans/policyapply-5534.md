# policyapply-5534: an enrolled board applies the company policy (kosmos#5534, E0.5 board slice)

## Done looks like
On an enrolled work Kosmos, the signed policy the coordinator serves on the org-status answer is saved where
engine/orgpolicy.js reads it and applied, on start and daily (the existing enrollment refresh). A policy that disallows
a provider then stops a new agent on it (create.js policyAllows, already wired); a tampered, foreign-signed, expired or
older bundle is refused and the last good one stays in force (orgpolicy.refresh, already built).

## Decided
- Applied in orgenroll's refresh, right after the enrollment record is written, so only an enrolled world (statusVerdict
  'here') ever saves a bundle. Written atomically (temp + rename, mode 600). A failure to save leaves the enrollment as
  it is; the next refresh tries again. An answer with no policy writes nothing.
- NOT in this slice: reporting the applied version to the console (the card's third done-condition). The rollup already
  has a policyVersion field, but the coordinator ignores it until the consent words name it (org.rs RollupReq comment),
  and changing those words makes every member re-accept. That is its own slice across both repos.
- Weakest premise: that the existing daily refresh cadence is fast enough for a policy change; a board picks up a
  newly saved policy at its next start or within a day.

## Review decisions (rounds 1-7)

- An answer with no bundle (policy: null, or no field from an older coordinator) never lifts a policy. The coordinator
  keeps every company's newest policy and has no delete, so a company lifts its rules by saving an open policy, which
  is signed. Rejected: clearing on null (round 2), because an unsigned answer could then loosen the policy (round 5).
- A policy of another company than the enrolled one is ended before the new company's is applied, on refresh, a
  settled join, a refused leave and a join by code; a bundle of another company waiting on disk is ended too.
- The highest version seen per company survives a clear, so an older bundle replayed after a rejoin is refused.
- A refused last-admin leave restores what was in force, then takes the answer's policy over it.
- Decided, not fixed: a leave not yet confirmed drops the policy at once (the person chose to leave; reports stop at
  the same moment). A leave left pending across a restart, then refused as last admin by a coordinator without the
  field, brings nothing back until the next refresh. Weakest premise: that a person leaving on purpose is not the
  threat this guards against (the module header already says it does not stop the Mac's own user).
- Not tested: the server join hook's 5 second wait (live execution is off under node --test). The refusal is only
  returned, never shown: the next slice (reporting the applied version, E0.3) surfaces it.
