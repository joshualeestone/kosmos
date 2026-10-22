# familywords-6870: a family with no policy is told the policy keeps agents out of shared projects (kosmos#6870)

Stacked on kidcommunity-6862 (#6862); rebase onto main with --onto once it merges.

## Change
- orgpolicy.contactAllows: when #6859's family default closes outside contact (no policy, or one that does not set
  outside_contact), `because` is FAMILY_CONTACT_STOPS (engine/orgpolicy.js; its wording is the console's, see review 2) and
  `family: true`. A policy saying off keeps
  CONTACT_STOPS. CONTACT_STOPS and FAMILY_CONTACT_STOPS exported.
- fedseats.contactStops(): the reason in force after contactState() gave 'policy'. contactState keeps its three values on
  purpose: the room view branches policy | unreadable | else-open, so a new 'family' value would say "every post here is
  sent to them" on a closed room.
- server.js: the three shared-project sentences say the reason in force: federationPolicyStop (invite, verify, join,
  own-code), the shared room's first line, the note on a post that stayed here. A policy saying off reads exactly as
  before (same text).

## Decided, not missed
- The sentence says "until a parent allows outside contact in the family's policy": the console's row is "Outside
  contact" with the values "Allowed" and "Not set" (kosmos-relay coordinator/src/console.html, review 2). Weakest
  premise: that a parent reading it on their own board knows the family's policy is in that console.
- contactStops is a second read after contactState; a change between them gives the policy's sentence for that one
  message (as #6862's policyStops).

## Tests
- server.familywords-6870.test.js (real routes): a family with no policy, and with a policy without the key, is
  refused verify in the family words, nothing signed; the room line and the stayed-here note in the family words;
  controls: a company with outside contact off keeps the policy's words.
- engine/kidcontact-6859.test.js: its family-no-policy arm expected the old sentence; it now expects the family words.
- Mutations: contactAllows' family branch back to CONTACT_STOPS (2 red); the route, the room line and the note each
  frozen to the policy's text (1 red each).
- 15 test files naming the touched code: 359 pass, 0 fail.

## Review 1 (sonnet)
- NIT fixed: the room line chose its wording by comparing text with CONTACT_STOPS; it now branches on the `family`
  flag contactAllows sets (fedseats.contactReason: { family, text }), and the fallback takes op.CONTACT_STOPS instead
  of a hard-coded copy. Mutations: the room line always the policy form (1 red), the flag inverted (1 red).
- Not added: a family arm with `outside_contact: {}`. The board refuses that bundle ("not one this Kosmos
  understands"), so the state cannot happen.
- Accepted: contactReason's second read (documented). The throw / now-allows fallbacks are not exercised by a test.

## Review 2 (opus)
- SHOULD-FIX fixed: no test held a FAMILY whose policy says off to the policy's own words (both controls were a
  company). Arms added on verify and the room line, and contactAllows' family flag absent there. Mutation: the family
  branch checked before a policy saying off (2 red).
- NIT fixed: wording "until a parent allows outside contact in the family's policy" (the console's label and value).
- NIT fixed: the room line is two sentences, the closed fact first, as the policy form reads.

## Review 3 (sonnet)
- NIT fixed: the Change section quoted the old wording; it points at the constant now.
- Accepted: the stayed-here note has no family-with-policy-off arm (the room line has one; both take contactReason).
