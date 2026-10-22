# familywords-6870: a family with no policy is told the policy keeps agents out of shared projects (kosmos#6870)

Stacked on kidcommunity-6862 (#6862); rebase onto main with --onto once it merges.

## Change
- orgpolicy.contactAllows: when #6859's family default closes outside contact (no policy, or one that does not set
  outside_contact), `because` is FAMILY_CONTACT_STOPS ("on a family's Kosmos, agents stay out of projects shared with
  other computers until the parent turns on outside contact") and `family: true`. A policy saying off keeps
  CONTACT_STOPS. CONTACT_STOPS and FAMILY_CONTACT_STOPS exported.
- fedseats.contactStops(): the reason in force after contactState() gave 'policy'. contactState keeps its three values on
  purpose: the room view branches policy | unreadable | else-open, so a new 'family' value would say "every post here is
  sent to them" on a closed room.
- server.js: the three shared-project sentences say the reason in force: federationPolicyStop (invite, verify, join,
  own-code), the shared room's first line, the note on a post that stayed here. A policy saying off reads exactly as
  before (same text).

## Decided, not missed
- The sentence names the parent and "outside contact", the policy key's own name; weakest premise: that a parent finds
  the setting from those words (the family console label was not checked).
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
