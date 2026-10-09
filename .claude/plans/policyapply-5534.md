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
