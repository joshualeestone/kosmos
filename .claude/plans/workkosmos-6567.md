# workkosmos-6567: no "work Kosmos" for a family outside inKind and plusOrgIn

Card: kosmos#6567 (follow-up from #6565, Renet's PR #6568). Built on #6565's shared rule: for a family,
"your work Kosmos" becomes "your family's Kosmos" in both inKind (engine) and plusOrgIn (page); the page alone also
turns "your work Kosmos for" into "in". Developed on #6565's branch; rebased onto main once #6568 merges.

## What #6568 already covers (not repeated here)
Settings' joined line ("This Kosmos is in <family>."), both leave-refused lines, the stopped-reporting line, NOCONFIRM.

## Change
- engine/orgenroll.js:
  - reviewHere's refusal "This Kosmos is not your work Kosmos, so there is nothing to review here." and enrollNow's
    org_not_here "This Kosmos is no longer your work Kosmos, so nothing was sent." now go through inKind(KIND, ...).
  - setStopped(name, opts, kind) keeps the org's kind beside its name in org-stopped.json; stoppedKind(opts) reads it
    ('family' | 'company'; a note from before kinds were kept reads as a company's). Both stop paths pass KIND.
  - reviewHere's KIND falls back to the stopped note's kind once a stop cleared the record (review 1: the screen may still
    offer "Read the family's words" until its next read, and the refusal then said "work Kosmos").
- server.js GET /api/org: sends stoppedKind beside a stopped note, and only then (the reply's shape is unchanged
  otherwise; server.orgenroll-5531.test.js pins it).
- web/index.html:
  - the stopped note says "This Kosmos is no longer in X" for a family (as #6565's Settings line says "is in"), and
    keeps "no longer the work Kosmos for X" for a company.
  - the review preview's refusal is said through plusOrgIn (that button is a family's), and a stopped note carried
    across a dropped read (review 13's path) keeps its kind.
  - a leave refusal (r.because) is said through plusOrgIn with the org the page left. This covers the server's plain
    refusal when the board is no longer enrolled ("This Kosmos is not your work Kosmos. Leave from your work Kosmos.").
    Leave is offered only on a joined screen, so this reaches a screen gone stale (a stop between its last read and the
    press): the board has no record and cannot know the kind; the page still holds the org it showed.
- org_already_member and org_bad_world: FAMILY_SAY already words them for a family; nothing to change.

## Decisions
- Fix the server's leave refusal on the page, not the server. Rejected: asking the coordinator for the kind from a
  refusal path (a network call to say no), or a kind-neutral sentence (changes the company's words).
- Not reworded: ~482 "Your family does not name this Kosmos as your family's Kosmos right now" (the card's optional
  wording pass). Correct as #6565's rule makes it; rewording both kinds' copy is a separate copy decision.
- Weakest premise: every place that shows r.because from a leave is the one in plusOrgLeave (the only caller of
  plusOrgPost('leave')).

## Checks
- engine/workkosmos-6567.test.js (real engine, fake coordinator): a family that stops naming this world keeps
  kind 'family' beside its name, a company keeps 'company' (CONTROL), an old note reads as a company's; the review
  Accept after the record went (org_not_here) says "your family's Kosmos" for a family, "your work Kosmos" for a
  company; reviewHere's refusal goes through inKind.
- web.workkosmos-6567.test.js: plusOrgIn turns the server's exact leave refusal into the family's words (company and
  no-org CONTROLS); the page wires plusOrgIn into the leave result and the stopped note branches on stoppedKind; the
  server sends stoppedKind only beside a note.
- server.orgenroll-5531.test.js: GET /api/org sends stoppedKind 'company' for an old note, 'family' for a family's,
  and no stoppedKind with no note.
- render-org-family-6239.js W1/W2: on the real page, a family's leave refusal and stopped note read in its words, each
  beside a company CONTROL.
