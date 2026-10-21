# kidcommunity-6862: a family's agents never take part in the community (kosmos#6862, option b)

Stacked on kidcontact-6859 (#6859); rebase onto main with `git rebase --onto origin/main <kidcontact-6859 tip>` once
that merges.

## Goal
Josh, 2026-10-15 10:45 (#6239): an agent created by a kid "is not to participate in the community aspect". After
#6859 a family's computer keeps agents out unless the policy says `outside_contact: { enabled: true }`; a parent who
turns that on lets a child's agents into the public community, which makes the #6379 terms sentence ("a child's
agents do not take part in the Kosmos Community") false in that case.

## Change
- `orgpolicy.communityAllows(policy, kind)`: on a family's computer never, whatever the policy says; a policy saying
  `{ enabled: false }` keeps its own sentence; otherwise the family's sentence ("on a family's Kosmos, agents do not
  take part in the Kosmos+ community"). For anyone else the same answer as contactAllows.
- The community readers use it: the send layer (contactWords, and notOnWords now says the actual reason), the
  community switch (participating), the agent's community block (policyStopped, and stoppedBody picks the family's
  lines on a family's Kosmos), and Settings' community switch sentence (server.js, a family sentence).
- Shared projects still follow contactAllows (fedseats, the federation routes), so a parent's allow still opens them.
- `isStoppedSection` accepts either form of the stopped lines, so a block written under one reason is still read as
  stopped after the reason changes.

## Decided, not missed
- Option (b) of #6862, as recommended there: the community is the part Josh ruled on; shared projects stay the
  parent's call. Rejected (a), the coordinator refusing `{ enabled: true }` for a family: it would also close shared
  projects, which #6239 lists as a default, not a rule.
- The family's sentence names no policy, so it is also true for a family that never saved one (the wording #6859
  deferred). A policy that says off keeps "the policy set for this Kosmos keeps agents out ...", which is true then.
- communityAllows reads the kind unless the policy says off, so on a company with `{ enabled: true }` a damaged
  enrollment file now closes the community (a throw, read as closed by every community reader); shared projects
  still decide without the read.
- Weakest premise: that a parent never wants a child's agents in the public community. Josh's ruling says so; a
  parent's own computer joined to the family is kept out of it too (the #6859 premise).

## Tests
- engine/kidcommunity-6862.test.js: a family with `{ enabled: true }`: shared projects open, community refused, the
  agent told the family's reason, the family's stopped lines; a company with `{ enabled: true }` takes part
  (control); a family with no policy hears the family's sentence, a policy saying off keeps its own; either stopped
  form is read as stopped and the rules are not (control); explicit arguments.
- Mutations: communityAllows as contactAllows (3 red); stoppedBody always the policy's lines (2 red); isStoppedSection
  reading only the policy's form (1 red); notOnWords with the fixed sentence (1 red).
