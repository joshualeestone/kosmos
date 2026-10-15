# familyreaccept-6239 (kosmos#6239 slice 2: a parent re-accepts a family's CHANGED words)

Card: joshualeestone/kosmos#6239. Stacked on `familycheck-6239`, which is stacked on Renet's `familywords-6239`
(the family consent panel at joining). Picked with Renet 16:49 CDT 10-15 (her list, item 2; her plan's "Not done
here": "a family's changed words stop reports until rejoin ... Settings has no screen for that yet").

## The gap
When a family's words change after a computer joined, the coordinator refuses its reports (org_consent_changed) and the
board withdraws the old words. For a company the board re-accepts the new words itself (reacceptWords, #5791). For a
family it cannot: the coordinator refuses a family's enroll without wordsShown, and reacceptWords never sets it (by
design: a machine did not show anything to a parent). So a family's computer stops reporting, the joined view says
only "once Kosmos has your company's current terms", and nothing a person can press fixes it short of leaving and
joining again.

## What this branch does
1. `server.js` GET /api/org: `wordsNeeded` (boolean, screen callers only): enrolled here, the record's org is a family,
   and no accepted words are on record (acceptedConsent is null: the words changed, were withdrawn, a print was not
   pinned, or the record predates kept words). A company is never `wordsNeeded`: it re-accepts on its own.
2. `web/index.html`:
   - the family panel (`#plus-org-family`) moves out of the code block (`#plus-org-out`) to sit beside it, so it can
     show over the joined view too. Its behaviour at joining is unchanged.
   - the joined view, when `wordsNeeded`: "This Kosmos is joined to <family>. The family's words changed, so it reports
     nothing until a parent or guardian reads and accepts them." and a button, Read the family's words
     (`#plus-org-words`).
   - the button asks for the review (`/api/org/preview { review: true }`, which existed: reviewHere, #5531 follow-up)
     and shows the words in the same panel, with a lead saying they changed and an Accept button.
   - Accept sends the codeless enroll `{ accepted: true, ticket, wordsShown: true }` (the review answer carries
     move: true, so the existing move path builds it). Not now accepts nothing, says so, and returns focus to the
     button; a refusal with a code closes the words and returns focus to the button.
   - `PLUS_ORG_FAMILY` is declared beside `PLUS_ORG` (a `var`), because plusOrgPaint now reads it and could run before
     a later `let` line.

## Decided
- A field, not the org's kind, on GET /api/org: #6251 (Renet) adds `org.kind` there for the family wording; this
  branch does not touch that object, so the two do not collide. `wordsNeeded` is also the more direct answer: the page
  needs "a parent must act", not a kind it would then combine with reporting state itself.
- The same panel, not a second screen: the words a parent accepts at joining and after a change are shown the same way.
- Server unchanged otherwise: the review preview, the family ticket and the wordsShown check all existed.

## Weakest premise
That reviewHere's refusal reasons read well to a parent (they are company-worded: "Your company could not be asked
..."). Family wording across these sentences is #6251.

## Measured
- server.familyreaccept-6239.test.js (3): a family whose words changed is wordsNeeded; the review preview serves the
  family's current words; Accept without wordsShown is refused with nothing sent; with it, the coordinator gets the NEW
  hash and wordsNeeded clears; a company with its words withdrawn is never wordsNeeded; a caller that is not the screen
  never sees the field. Mutant: wordsNeeded forced false, 1 test red.
- docs/browser-checks/render-org-family-6239.js arms R1 to R6, chromium and webkit, all pass. Mutants: the words row
  never shown (R1 red); Not now ignoring a review (R3 red).
- Updated pins: web.familywords-6239.test.js lifts plusOrgFamilyNotNow, which now reads PLUS_ORG_FAMILY and calls
  plusOrgPaint/plusOrgFocus (passed in); server.orgenroll-5531.test.js pins /api/org's shape, now with wordsNeeded.

## Not done here
- The rollup still retries a family's automatic re-accept on its backoff, and each one is refused; harmless (it sends
  nothing a parent did not accept) and bounded by the existing backoff.
- Family wording of the joined line after accepting, and of every other org sentence: #6251.
