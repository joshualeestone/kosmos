# joindesc-5287: a joined project shows who shared it and what THEY wrote about it (kosmos#5287)

**Finished means:** after joining another account's shared project, its page says "Shared by <owner>.kosmosplus.com."
(or "a Kosmos+ account with no name yet") and the owner's description, quoted as theirs; the project's own
description (the brief its agents get) stays empty, as the join route has always deliberately kept it.

## Found (traced, confirmed with PigeonPete who found it in the 10-05 rehearsal)
The join route never copies the owner's description into the project (server.js: "never written into this
computer's brief as if the person here wrote it") but stores it in the federation link (recordLink member
project_desc). Nothing read it back: no route sent it, the page showed it only on the join screen.

## Change
- server.js GET /api/projects: `shared: { owner, description }` on each project with a MEMBER link (from
  federation.linkFor); a `self` link or no link adds nothing; an unreadable link adds nothing.
- web/index.html: a hidden-by-default #pj-one-shared block under the made line, painted by pjPaintShared (textContent
  only), called from paintOneProject. No-name wording matches the join screen.

## Decided
- Keep the brief empty (the join route's rule); show the owner's words attributed. Rejected: copying them into the
  project description (they would read as this person's own instructions to their agents).
- PigeonPete confirmed no slice draws a member-side "Shared by" (his slice F is unbuilt), so this builds both halves.

## Weakest premise
That the owner's description is safe to show as text: it was cleaned and bounded at verify (federation.verify:
format/invisible/control characters removed, DESC_MAX) and is painted with textContent only.

## Tests
server.joindesc-5287.test.js 5/5 (route: member with and without owner/description, self link, CONTROL unshared;
page: owner, no name, no description, CONTROL not shared; wiring). Mutants (route field removed; painter call
removed) each turn it red. Related server.fed*/federation/project + every web.* + guards: 2782/2782.
