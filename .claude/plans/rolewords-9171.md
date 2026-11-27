# #9171: say when a project role that names review or QA still gets Assigner tasks

Split from #9166 item 2. #7429 already says when a role reads as review only (`reviewOnly: true`, both CLIs print a
line). The gap: a role that NAMES review or QA but does not match the exact forms ("QA only on mobile", "builds and
reviews") keeps the member in the Assigner's hand-outs, silently.

## Change
- engine/projects.js `mentionsReview(role)`: the role names review (any review* word) or QA, as whole words.
- server.js POST /api/project/:id/role: also answers `stillAssigned: true` when the saved role names review or QA but is
  not review only. From the role just saved, like reviewOnly.
- install/kosmos and tools/windows/kosmos-cli.js: one line, the same words on both: "It names review or QA, but not as
  your whole role, so the automatic Assigner still hands you this project's tasks. To stop that, make the whole role
  "review only" or "QA only"."
- The review-only match itself is unchanged (deliberately exact, #7429).

## Rejected
- Loosening REVIEW_ONLY so "QA only on mobile" counts: a wrong yes takes an agent out of hand-outs (#7429's reasoning).
- A separate tag field: a bigger change than the reports ask; the one-line answer closes the silent part.

## Weakest premise
That an agent reads the line when it sets the role. A role set from the screen gets no line (the screen sets roles
for others; #7429 left that as is).

## Tests
- engine/projects-mentionsreview-9171.test.js (3): near misses flagged, review-only forms named, and "preview",
  "Qatar", "quality lead", non-strings not flagged.
- server.project-role-5300: "builds and reviews" and "QA only on mobile" answer stillAssigned; CONTROL "Builder" none.
  (The existing assertion for "builds and reviews" changed on purpose: it now carries the flag.)
- Both CLI files: the line with the flag; CONTROL none without it.
- Controls, each a perturbed copy, each 1 fail: the route's flag dropped; the Unix line's match broken; the Windows
  line disabled; the word boundary removed from NAMES_REVIEW.
- Every test file naming either CLI (200 files): 2536 tests, 0 fail.

## Reviews
