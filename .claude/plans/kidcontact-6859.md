# kidcontact-6859: a family computer keeps its agents out with no policy saved (kosmos#6859)

## Goal
Josh, 2026-10-15 10:45 (#6239): an agent created by a kid "is not to participate in the community aspect". The board
kept agents out only under `outside_contact: { enabled: false }`, which a family gets only when a parent saves the
Family preset or sets it by hand. A child's computer in a family whose parent never saved a policy could post, reply
and follow in the public community.

## Change (engine/orgpolicy.js, engine/orgenroll.js)
`contactAllows(policy, kind)` takes the org kind this board is joined to, read by `orgenroll.kindStrict()` only when
the policy does not settle it (says neither on nor off) and the caller gave no kind. On a family's computer outside contact is stopped unless
the policy says `outside_contact: { enabled: true }`: no policy, a policy without the key, or `{ enabled: false }`
all keep agents out. A company, or a computer joined to nobody, is unchanged (only `{ enabled: false }` stops it).
Every reader goes through this one function (community send, community switch, the agent's community block, shared
rooms), so all of them follow.

`kindStrict` (reviews 4 and 5): reads the three enrollment files itself, once each, rather than through readers
that answer null on a fault: the record, a pending leave and a pending join, all three, and a family's if any says
so (a move into a family keeps the old company record until the join settles). A file that parses to an object but
names no kind (from before kinds, or with an identity readEnrollment rejects) is a company's; a file that is there
but cannot be read, or is not a JSON object, throws; null only when none of the three is there.

## Decided, not missed
- Board side, not coordinator: it needs no coordinator deploy and covers a family that already exists with no
  policy. The card left the choice to the builder.
- A parent's explicit `{ enabled: true }` is honoured (the console offers it, and a parent may want a kid's project
  shared with their own computer). Consequence: the #6379 terms sentence "a child's agents do not take part in the
  Kosmos Community" is true unless a parent turns outside contact on. If that sentence must hold without exception,
  the follow-up is that the coordinator refuses `{ enabled: true }` for a family (one check in org.rs) or the board
  ignores it for the community only: filed as #6862 (mine, after this merges).
- The refusal sentence is the same one the policy gives ("the policy set for this Kosmos keeps agents out ..."), so
  the agent's community block, the send layer and the console words stay one sentence.
- Weakest premise: that only children's computers join a family. #6239 describes the parent as the org admin who
  works from the console; a parent who also joins their own computer to the family has its agents kept out too,
  until they allow outside contact.

- Review 1: the kind is read strictly (orgenroll.kindStrict): the record's kind, else a pending join's or leave's,
  else null only with no enrollment file at all; a record that is there but cannot be read throws, which every
  caller already treats as closed (community 'policy_unreadable', shared rooms stopped). Before, a damaged or
  half-written record read as joined to nobody and let a family's agents out. This also closes the community on a
  COMPANY board with a damaged record, which is the safe direction. Every enrollment writer includes `world`
  (required since #5531), so a valid record never reads as damaged.
- Review 1, deferred: the sentence "the policy set for this Kosmos keeps agents out" when a family saved none.
  #6239 lists "no outside contact" among the Kids default policies, so the default is a policy set for that
  Kosmos; one sentence keeps the agent's block, the send layer and the console words identical.
- Review 2: a damaged record throws even with a join or leave marker beside it (review 1 let the marker stand in,
  so a damaged family record plus a company join opened contact); a marker that names no kind (older builds) reads
  as a company's instead of throwing, so no company board is closed by legacy state.
- Review 2: a family leave the coordinator has not confirmed keeps agents out until it is (the safe direction).
- Review 2, deferred: a throw is worded by every caller as "cannot read the policy set for this Kosmos ... (tell
  your person)". On a damaged enrollment that names the policy, not the enrollment; it is still a fault the
  person should hear about, and rewording every caller's fault sentence is outside this card.
- Review 2, deferred: on a fault the agent's community block keeps the rules (communityblock.policyStopped reads a
  throw as not stopped, so a fault never rewrites every agent's instructions) while every send is refused. That is
  the existing posture for a damaged policy record; nothing leaks.
- Review 3: kindStrict reads the record file once, so a join that lands between a read and a stat is never taken
  for a damaged record (kept in review 4's design; the shared enrollmentFrom it added is gone with it).
- Review 3, deferred: the moments with no record and no marker, which read as joined to nobody: a join before its
  marker exists, and a leave after its record is cleared and before its marker is written. In both the computer is
  between memberships (before the join is confirmed it is not yet the family's); reordering the leave's writes is a
  change to the leave flow, outside this card.
- Review 3, checked: the console's Family preset sets Outside contact off, so `{ enabled: true }` comes only from a
  parent choosing it.
- Review 4: the kind is separated from the identity. Reviews 1 to 3 read the kind through readEnrollment, which
  answers null for a record whose identity is not valid, and then threw; nothing clears such a record, so a
  company board would have been closed for good. The kind now comes from the parsed file whatever its identity, and
  only a file that cannot be read or parsed throws, which covers torn markers too (they used to read as a company's).
- Review 4, noted: a family's refused community acts are reported to the console as the outside-contact rule (the
  agent-events refusal report) even when the parent saved no policy. That is true of the Kids default (#6239 lists
  no outside contact among them).
- Review 4, noted: the guarantee ends when the child's computer leaves the family (a confirmed leave removes the
  record and its marker). That is the same for every policy, and #6862 records it beside the explicit-on caveat.
- Review 5: all three files are read, not the record first: a move from a company into a family keeps the company
  record until the join settles, and the record used to win. JSON that is not an object (null, a string, an array)
  now throws instead of reading as a company's.
- Review 6: an hourly refresh whose answer names no kind (an older coordinator's; today's names it on every route,
  org.rs) leaves a family's record of the same org a family's; cleanOrg alone would have recorded it as a company's
  and opened contact. An org's kind does not change, so this keeps nothing stale.
- Review 6: the kind is read only when the policy says neither on nor off, so a set policy decides without the up to
  three enrollment reads and cannot be turned into a throw by a damaged enrollment.
- Review 6, deferred: a leave whose pending marker fails to write (setLeavePending is best effort) and whose record
  is then cleared reads as joined to nobody. It needs the data folder to fail a write, and the leave flow is outside
  this card.
- Review 6, deferred: agents already running when a board joins a family keep the community rules in their
  instructions until the board restarts (refreshEveryone runs at start); every send is refused meanwhile. The same
  gap exists for a policy applied while running (#6239).
- Review 7: settleUnknownJoin removed the join marker BEFORE writing the record (and before writing the undo's
  pending leave), so a crash between the two left none of the three files and the next start read a family's
  computer as joined to nobody. The marker is now removed only after what replaces it is written, as enroll already
  did, so no writer order leaves none on disk. kindStrict reads the join marker, then the record, then the leave
  marker. Review 8 corrected the claim made here that this order covers every writer: two writers swap the record
  and the leave marker the other way, so no single order of three reads does. It does not need to: every writer and
  every reader is in the board process and each writer's pair of writes is synchronous, so no read falls between
  them (a reader in another process could; none exists). The code comment claiming the order was removed.
- Review 8: the join's known kind also holds in enroll and in a settled join when the answer names none
  (keepFamily), not only on the hourly refresh; the settle path is tested and mutation-proven (1 red), the enroll
  path is tested since review 14. A settle whose record
  write fails no longer rewrites the marker (it is still there now, and rewriting it reset its age).
- Review 8, pinned: the coordinator's explicit kind wins on refresh (a family record answered 'company' becomes a
  company's); only an answer naming no kind keeps a family's.
- Review 9 then 10: a line keeping the undo's join marker until its pending leave was written was added and then
  reverted: leaveNow, called straight after, retires the world id and removes the marker anyway, so it did nothing
  and its comment was false.
- Review 10, decided (scope): this card's guarantee is a SETTLED membership (a family record, or a family's pending
  marker on its own) and a damaged file. The moments a join or leave is changing state are not made fully strict
  here: the refresh removing a join marker beside a record before its answer arrives (a move from a company into a
  family), an incomplete 'here' answer removing the marker of a first join, and a failed write of an undo's pending
  leave. Before this branch every state of a family's computer was open, so each is a narrower remainder of the old
  behaviour, not a regression; each needs the join flow's own writes reordered, which is that flow's change to make.
- Review 9, decided: a computer the org stopped (its record cleared, a stopped note left) reads as joined to nobody,
  and its agents may reach outside. The family removed it; the same holds after a confirmed leave.
- Review 12: enroll keeps a family's kind also when this board's current record is a family's (the screen always
  passes an explicit kind, taken from a preview that reads a missing kind as a company's, so the join's own kind
  alone never said family in the case keepFamily is for). Review 13: only the record of the SAME org, as refresh
  requires, so a move from a family to a company is not recorded as a family's. Tested since review 14.
- Review 12: the refresh clears a join marker beside a record by its presence on disk, not by whether it parses:
  a torn marker no refresh could read would otherwise have closed a company board for good (tested and
  mutation-proven, 1 red).
- Review 14: enroll keeps a family's kind for the same org only, and otherwise uses the kind the caller passed
  (not the old record's, through KIND's fallback), so the function guarantees it whatever its caller; tested with
  three arms (same org, another org, another org with no kind passed) and mutation-proven (1 red each). Refresh
  uses keepFamily too (one copy of the rule). A join marker that cannot be read is removed by the next refresh
  with no record beside it as well (tested, 1 red).
- Review 14, decided: an enrollment RECORD that cannot be read keeps outside contact closed until it is repaired.
  It means this board cannot tell whether it is a family's, which for this rule is the case to close; the person
  is told through the fault sentence (tell your person). It needs real damage (records are written whole).
- Review 1, deferred: one more small file read per contactAllows call (currentStrict already reads one per call);
  the require is lazy, so there is no load-order cycle.

## Tests
- engine/kidcontact-6859.test.js: family with no policy is out (policy verdict, community state, shared rooms); a
  company with no policy and a computer joined to nobody are in (controls); in a family a policy without the key
  keeps agents out, `{ enabled: false }` keeps them out, `{ enabled: true }` lets them out; a company policy without
  the key lets them out; explicit arguments read as given.
- Mutations: the family clause removed (3 red); a family always kept out (2 red: the parent's allow is not
  honoured).
- Review 1: a damaged enrollment throws (community 'policy_unreadable', rooms stopped); a family join not yet
  settled keeps agents out, a company's does not (control); the agent's community block is stopped for a family
  and not for a company. Mutation: kindStrict back to kindHere (the fail-open read): 1 red.
- Review 2: a marker beside a damaged record does not hide it; a kindless marker reads as a company's; a family
  leave not yet confirmed keeps agents out; throws are matched by their words. Mutations: review 1's kindStrict body
  (red: a marker hid a damaged record); a kindless marker throwing (red).
- Review 4: a torn leave or join marker throws; a record with a bad identity keeps its kind (a company's stays open,
  a family's stays closed); a move into a family reads as a family's. Mutations: a torn file read as missing
  (2 red); a move taking the first marker (1 red).
- Review 5: a company record beside a family join not yet settled reads as a family's; a record of null, a string
  or an array throws. Mutations: the record winning (1 red); a non-object read as a company's (1 red); a torn file
  read as missing (2 red).
- Review 6: a set policy decides with a damaged enrollment on disk (no read, no throw); a refresh answer with no kind
  keeps a family's record a family's, a company's a company's. Mutations: the kind-keeping line removed (1 red); the
  kind read before the policy (1 red).
