# Plan: roles-email

Josh, #chaoskosmos-design, 2026-08-25: "Let's add an Email type of agent
to the list of predefined roles and capture all the necessary things we
need... we could model some of it off of what we have for Vivienne."

## Change

New role `email` / "Email Assistant", in the "Running the work" group
next to Executive Assistant, in `engine/roles.js`. Bumped the catalogue's
own count assertion (`create.test.js`) from 29 to 30, with a dated
comment explaining why, matching the precedent set when Product Director
was added.

**Shaped against a real account of the job, not a generic guess.**
Vivienne (a real worker who actually does email work) was asked directly
what the shape of the job is; her answer is condensed into the role
against the catalogue's own house rule (three "How you work" bullets,
no more):

- Draft, never send, no exceptions (the load-bearing boundary, matching
  the Executive Assistant precedent's own caution).
- Silence is not a no: prepare and show the result rather than asking
  whether to (her point, added after she caught that my first draft's
  three bullets covered only two distinct ideas -- without it, "a
  well-behaved role... sits idle for days," her words, describing her
  own last week).
- If something is actually broken, say so immediately; that one thing
  does not wait for permission, unlike everything else (the send-vs-
  escalate asymmetry she flagged as having caused a real six-hour
  overnight outage once conflated).

Her sharpest warning that did not fit as a bullet ("search every
account, do not trust the subject line -- a reply often lands under a
new subject") folded into the "Who you are" character section instead,
which has room for it.

Also updated `kosmos-role-catalogue.md` (the spec this file is built
from) with the same entry, and fixed the header comment's stale "26
roles" count while in the area (now points at the test as the source of
truth instead of repeating a number that will drift again).

## Explicitly not built here

The 3-4 personal/family roles from the same conversation -- proposed
four concrete candidates to Josh (Household Manager, Family Coordinator,
Personal Assistant, Travel Planner) rather than build them from his more
tentative "I think we could" wording; waiting on which of them he wants.

## Verification

- [x] `node --test engine/create.test.js`: 104/104 pass, including the
      mechanical checks that every cautioned role's boundary is
      registered and stated in its own instructions, and that every
      role carries a 3-6 sentence "Who you are" section with no em dash.
- [x] `npm test` (full suite): 0 failures.
- [x] `bash tools/browser-checks.sh` (full suite); one flaky failure
      (`render-projects`, unrelated to this change -- it touches project
      archive/restore, not roles) confirmed as machine contention via an
      isolated rerun, which passed clean (18/18).
