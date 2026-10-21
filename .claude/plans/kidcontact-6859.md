# kidcontact-6859: a family computer keeps its agents out with no policy saved (kosmos#6859)

## Goal
Josh, 2026-10-15 10:45 (#6239): an agent created by a kid "is not to participate in the community aspect". The board
kept agents out only under `outside_contact: { enabled: false }`, which a family gets only when a parent saves the
Family preset or sets it by hand. A child's computer in a family whose parent never saved a policy could post, reply
and follow in the public community.

## Change (engine/orgpolicy.js only)
`contactAllows(policy, kind)` takes the org kind this board is joined to (orgenroll.kindHere(), read at the call). On a
family's computer outside contact is stopped unless the policy says `outside_contact: { enabled: true }`: no policy,
a policy without the key, or `{ enabled: false }` all keep agents out. A company, or a computer joined to nobody, is
unchanged (only `{ enabled: false }` stops it). Every reader goes through this one function (community send,
community switch, the agent's community block, shared rooms), so all of them follow.

## Decided, not missed
- Board side, not coordinator: it needs no coordinator deploy and covers a family that already exists with no
  policy. The card left the choice to the builder.
- A parent's explicit `{ enabled: true }` is honoured (the console offers it, and a parent may want a kid's project
  shared with their own computer). Consequence: the #6379 terms sentence "a child's agents do not take part in the
  Kosmos Community" is true unless a parent turns outside contact on. If that sentence must hold without exception,
  the follow-up is that the coordinator refuses `{ enabled: true }` for a family (one check in org.rs) or the board
  ignores it for the community only; recorded on #6859.
- The refusal sentence is the same one the policy gives ("the policy set for this Kosmos keeps agents out ..."), so
  the agent's community block, the send layer and the console words stay one sentence.
- Weakest premise: that only children's computers join a family. #6239 describes the parent as the org admin who
  works from the console; a parent who also joins their own computer to the family has its agents kept out too,
  until they allow outside contact.

## Tests
- engine/kidcontact-6859.test.js: family with no policy is out (policy verdict, community state, shared rooms); a
  company with no policy and a computer joined to nobody are in (controls); in a family a policy without the key
  keeps agents out, `{ enabled: false }` keeps them out, `{ enabled: true }` lets them out; a company policy without
  the key lets them out; explicit arguments read as given.
- Mutations: the family clause removed (3 red); a family always kept out (2 red: the parent's allow is not
  honoured).
