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
- engine/kidcontact-6859.test.js: its family `{ enabled: true }` arm now expects shared projects open and the
  community closed (it expected both open before this card).
- The 73 test files naming the touched modules: 2094 of 2100 passed in one parallel run; the 3 other reds
  (backupscan, communityavatar, communityedit-5574, about 5 s each) pass alone (44, 32, 17), so they were contention.

## Review 1
- Settings' sentence is pinned: a source test requires server.js to choose FAMILY_COMMUNITY_STOPPED from
  communityAllows (mutation: always the policy sentence, red).
- Deferred: a company with outside contact on and a damaged enrollment file loses the community (communityAllows
  reads the kind there; unknown closes, the safe direction for a rule about children).
- Deferred: policyStopped and stoppedBody read separately; if the reason changes between the two, the block heals on
  the next refresh (isStoppedSection accepts either form).

## Review 2 (opus), folded at 8a65476bac
- BLOCKER fixed: on a family with `{ enabled: true }` the four frozen 'policy' sentences (refused post, refused
  comment, both status lines) said the policy keeps agents out of the community and shared projects, false twice.
  Now said with the reason in force (communitysend.policyStops / withPolicyStops). Tests: kidcommunity-6862 (post,
  comment, company-off control), communitystatus.test.js (both status lines, policy-off control). Mutations: each
  substitution removed (1 red each), policyStops fixed to the policy's (2 red).
- Fixed (was deferred in review 1): stoppedReason() is one read deciding both whether and which stopped lines, used
  by tellAgent and create.js. Mutation: family never reported (3 red).
- Decided: reportPolicyRefusal keeps 'outside-contact' on a family (nearest rule in the event feed; reason in code).
- 53 test files naming the touched code: 1497 pass, 0 fail, 2 skipped.

## Review 3
- Fixed: the community-ready report (communityready linesFor to the agent, ownerBoardFacts to the person) still said
  the policy's frozen sentence on a family that allowed outside contact. Both now take communitysend.policyStops().
  Test: kidcommunity-6862 (agent and person, company-off control). Mutations: linesFor frozen (1 red), board facts
  always the policy's (1 red).
- Swept the remaining copies of the policy sentence: server.js 24046 (a shared-project post) and 915 follow
  contactAllows, which is open on a family with `{ enabled: true }`. (Corrected in review 7: NOT true on a family
  with no policy or the key unset, where #6859's default closes contact and the sentence names a policy that does
  not exist. Shared-project wording, filed as #6870.)
  communityblock 307 is the policy form chosen by stoppedReason; server.js COMMUNITY_STOPPED is chosen against the
  family sentence (review 1).
- 5 test files naming communityready or policyStops: 78 pass, 0 fail.

## Review 4 (sonnet)
- SHOULD-FIX fixed: the report's "Your newest post" line indexed POST_WORDS directly, so a post refused under 'policy'
  on a family was described with the policy's sentence. My review-3 sweep searched for the sentence's text, not for
  readers of the tables that hold it, so it missed this. Now every reader goes through communitystatus.wordsFor, and a
  source scan (engine, server.js, web) holds that nothing else indexes the tables (with a control that the scan sees
  the one allowed use). Mutations: the line back to POST_WORDS (2 red), wordsFor without the substitution (2 red).
- NIT fixed: a pin that communitysend.POLICY_STOPS is exactly the sentence orgpolicy gives for a policy saying off
  (withPolicyStops and the board facts find it by text). Mutation: one word changed (4 red).
- NIT accepted and documented: policyStops is a second read after the one that decided 'policy'; a change or a throw
  between them gives a family the policy's sentence for that one message. The comment now says so.
- 50 test files naming the touched modules: 1089 pass, 0 fail, 2 skipped.

## Review 5 (opus)
- SHOULD-FIX taken, reversing review 2's decision: reportPolicyRefusal sent rule 'outside-contact' on a family whose
  policy allows outside contact, which tells the parent their own setting did not hold (a false reason on the one
  record that leaves the computer). It now reports only when contactAllows says no; a family-only refusal is said on
  the board and not sent (the feed has no community rule). A policy read that throws is not reported. Test with a
  policy-off control; mutation (the check removed): 1 red.
- NITs fixed: three comments that read 'policy' as the policy only now name the family case too.
- 60 test files naming the touched modules: 1538 pass, 0 fail, 2 skipped.

## Review 6 (sonnet)
- NIT declined: routing reportPolicyRefusal through the contactRead seam. That seam stands for communityAllows (always
  no on a family), so it would restore the false report review 5 removed; the comment now says it is deliberate.
- NIT fixed: the comment named only "the policy"; a family with no setting is closed by #6859's default and is
  reported (true there: shared projects are closed too). Test arm added for it.

## Review 7 (opus)
- SHOULD-FIX moved to its own card, #6870 (claimed): the shared-project refusals on a family with no policy name a
  policy that does not exist (#6859's deferred wording). It changes contactAllows and the federation readers, not the
  community; review 3's line above corrected.
- Kept: a family with the key unset reports rule 'outside-contact'. The event names the rule that stopped the agent,
  and outside contact is closed there (by the family default); it does not say the parent set it.
- NIT accepted: a stored 'policy' item whose reason has since gone (the computer left the family) is described with
  the policy's sentence. Main does the same after a policy is lifted; storing the reason at refusal time is a change
  to the sent-items record, out of scope.
