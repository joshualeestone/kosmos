# Plan: notify-comment-2013 - remove the two stale default-OFF comments in notify.js (#2013)

## Context

kosmos#2013 ruled that phone-home settings are **on by default** (Josh, 2026-09-03),
with `remote.js` the single exception (a paid service). Its acceptance clause is not
only about the default values but about the comments: *"No setting is off merely because
it was written that way"* and *"a comment asserting a retired principle is how the next
person re-derives the old behaviour."*

The default VALUES were already landed and served on main by prior merges:
- #2041 - heartbeat + autohandoff flipped ON (notify/ping held at the time)
- #2048 - remote.js paid-service default-off tripwire test
- the #2020 line (#2283 / #2313 / #2058) - created-ping opt-out restored + default ON
- notify's own default is already ON (ENOENT -> `{on:true}`), pinned by `notify.test.js`

What remained unaddressed was #2013's comment clause: two comments in
`engine/notify.js` still asserted the retired **default-OFF** posture, directly beside
the code that now defaults ON.

## Scope (this branch)

Comment-only change to `engine/notify.js`. No behaviour, no test outcomes.

1. Header comment (~line 11): drop the stale `off by default` clause; state the send is
   **ON by default** per the #2020 step-3 ruling, with the honest caveat that its POST
   reaches no notification relay yet, so notifications must not be reported as delivered
   on the strength of the flip.
2. JSDoc above `read()` (~line 62): replace `Off until somebody turns it on` with an
   accurate description of `read()` - never-asked default ON, only an explicit `false`
   (or an unreadable/unparseable pref) is off.

Explicitly out of scope: the default values themselves (already correct on main), the
Settings UI, and `remote.js` (correctly off, with its paid-service reason already
documented). Line 91's `(default OFF)` mention stays - it is correctly framed as
pre-step-3 history, not a current claim.

## Verification

- `engine/notify.test.js` (asserts ON-by-default + the fail-to-off cases the new
  comments describe) and the full pre-PR validation sequence.
- Challenge-loop blind review, watching specifically for any surviving comment that
  asserts a retired default-OFF (the exact #2013 defect class).

## Acceptance

No comment in `engine/notify.js` asserts a retired default-OFF; the two named comments
accurately describe the current ON-by-default behaviour; validation green.

Closes #2013.
