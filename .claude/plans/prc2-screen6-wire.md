# PR-C2: wire install-flow Screen 6 consent switches (#2037 + #2020)

## Context
Splinter GO 2026-09-06: install-flow #2316 merged on main (347a5803), which carries
Renet's Screen-6 MARKUP. PR-C2 is the Option-A wiring-only half: Renet owns the
markup, Angel owns the behavior. This applies onto the MERGED base in a fresh
worktree (prep was `prc2-screen6-prep`, written against Renet's unmerged branch;
re-verified against merged main). Baron cuts 6.38 staging once this merges (the
full install process for Josh's test).

## What "done" looks like
- The two static Screen-6 switches (`#fr-s6-feedback` #2037 daily report,
  `#fr-s6-createping` #2020 create ping), which Renet renders default-ON
  (aria-checked="true", role=switch), are now BEHAVED:
  - click AND Space/Enter toggle each one (flip aria-checked; Mona's CSS paints it);
  - a toggle PUTs its backend (/api/feedback-setting, /api/ping-setting), both
    default-ON, so these are the install-time opt-OUT;
  - the frGo step-6 branch refreshes both from the backend on show, so persisted
    state (or the default-ON) paints;
  - a could-not-read leaves the markup at default-ON, never a false Off.
- No markup added or changed (Option-A contract: her markup, my wiring).

## Verified against merged main (347a5803)
- Renet's markup matches the prep exactly: ids, role=switch, aria-checked="true",
  eyebrow "Self improving", headline "Help make Kosmos work better for everyone",
  copies "Have an agent send a daily report..." / "Let Kosmos know when you create
  an agent." (+ her aria-labelledby from the browser pass).
- Backend routes exist: GET/HEAD + PUT for both /api/ping-setting (server.js:3698,
  3703) and /api/feedback-setting (server.js:3723, 3728).
- The frGo step-6 branch is `} else if (step === 6) { frActions({ label: 'Next',
  go: () => frGo(7) }); }` with Renet's placeholder comment; refresh calls added.

## Approach
Insert the behavior JS (two toggle handlers + two refreshers + a top-level bind
IIFE) after the frGo function, and add `frRefreshFeedback(); frRefreshPing();` to
the frGo step-6 branch. New test `web.firstrun-consent-prc2.test.js` (source-grep,
6 arms) pins the wiring the route/engine tests cannot see.

## Verification
- `web.firstrun-consent-prc2.test.js`: 6 arms (markup default-ON, copies, each
  toggle flips + PUTs its backend, each refresh GETs + guards non-ok, click+keydown
  bound, frGo step-6 refreshes) - all green.
- Route round-trips: server.test.js. Engine defaults: feedbacksend.test.js /
  ping.test.js. Full validation suite + challenge-loop.
- **Live Screen-6 paint/toggle rides Baron's 6.38 staging cut** (the full install
  process). A dedicated firstrun-Screen6 headless render check is a deferred
  follow-up (the prep flagged it "post-apply, when the box is free"); adding one
  now trips the browser-check gate chain and is out of this launch-critical slice.

## Weakest premise
That the top-level bind attaches at runtime (the spans are static and precede the
script in document order, so getElementById resolves them). Standard DOM code, low
risk, and exercised end-to-end in the staging cut. Named so a reviewer checks it.
