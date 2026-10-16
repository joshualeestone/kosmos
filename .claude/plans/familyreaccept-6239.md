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
   - the joined view, when `wordsNeeded`: "This Kosmos is joined to <family>. The family's words are not accepted on
     this computer, so it reports nothing until a parent or guardian reads and accepts them." and a button, Read the family's words
     (`#plus-org-words`).
   - the button asks for the review (`/api/org/preview { review: true }`, which existed: reviewHere, #5531 follow-up)
     and shows the words in the same panel, with a lead saying they are not accepted on this computer and an Accept button.
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

## Review 1 (opus) fixes
- A review's refusals are said by the page for the joined view: the engine's company lines ("Kosmos tries again on its
  own", "Press Connect Account") do not hold for a family's review, where nothing retries and there is no Connect
  Account. With a code: "Nothing was accepted. Press Read the family's words to read them again." (and, for
  org_consent_changed, that the family changed its words while they were open); with none (Kosmos+ not reached), the
  words stay and it says to press Accept again.
- The family panel follows the view it was opened for (plusOrgPaint): a review's words close when this computer is no
  longer joined (a Leave, a read that says so); a joining family's words hold the block open and close once joined.
- "The family's words changed" was not always true: wordsNeeded also covers words never recorded here (a print not
  pinned, a re-adopted record). Both lines now say the words are not accepted on this computer.

## Review 2 (sonnet) fixes
- Review 1's refusal line was a claim of the loop's own and was wrong for several codes (it told a parent no longer in the
  family to read the words again, and said Kosmos+ was unreachable when the engine said it did not know). Replaced by
  plusOrgReviewSay: the engine's own reason, without the two sentences that do not hold for a family review ("Kosmos
  tries again on its own", "Press Connect Account"), plus "Press Accept to try again" (no code: the ticket is kept and the
  engine says accepting again is harmless) or "Read the family's words again" (a code), and nothing for
  org_not_member / org_other_org / org_not_here / org_bad_world.
- A refused leave while the words are needed says a parent is needed (not "once Kosmos has the current terms").
- An Accept the next /api/org read contradicts (still wordsNeeded: the print not pinned) says the computer could not
  record the words and offers them again.

## Review 3 (opus) fixes
- "Kosmos then tries again on its own." (the folder-write refusal) is stripped too.
- org_bad_world keeps the ticket and the words, so it says to press Accept again (it said nothing to do).
- No longer this family's (org_not_member, org_other_org, org_not_here): the view is read again and focus goes to the
  joined sentence, not to the words button.
- reviewAccepted is cleared when the read after Accept fails, and is in PLUS_ORG's initializer; no doubled "try again";
  the review lead says "accept them on this computer" (accepting does not always make it report).

## Review 4 (sonnet) fixes and one deferral
- The route's own catch line ("Nothing was sent to your company.") is said for the family in a review.
- A refused review preview (already accepted here, or no longer this family's computer) reads /api/org again, so the
  button goes when it no longer belongs (R12). R12 first ran red on the real page: the re-read sat after a finally that a
  return inside the try skipped; it now runs inside finally.
- reviewAccepted is a time: only a /api/org read that STARTED after the Accept may say the words were not recorded, so
  a read in flight from before the Accept cannot (reasoned from the code; not driven by the browser check).
- Deferred, with the reason: "reports nothing" when wordsNeeded. Review 4 noted that a record with a consent hash and no
  remembered words is wordsNeeded while mayReport() is true, so backups (gated on mayReport alone) can still run. The
  sentence is about reports, and in that state the rollup really sends none; backups have their own Settings screen.
  What would change this: if a family's backups should also wait for a parent, that is a backuptick change, not words.
  Moot since kosmos#6288 (relay#403, live 02:08 CDT 10-16): a family is never backed up, so no backup runs in that state.

## Review 5 (opus) fix
- A /api/org read that STARTED before the page's own last state write (a review's Accept) is dropped, so a read in
  flight from before the Accept cannot put the stale wordsNeeded view back (PLUS_ORG.wroteAt). Reasoned from the code.

## Reviews 6 and 7
- Review 6 (sonnet), two WARNINGs deferred with reasons. "could not record them" shows only when this computer's own
  record lacks the words (the read is local, must start after the Accept round trip, and wroteAt drops older ones).
  "Press Accept" after an Accept refusal cannot follow reviewHere's "already accepted here": an Accept goes through
  enroll, which never calls reviewHere.
- Review 7 (opus): a family's FIRST join can also end with no words recorded (print not pinned, words not kept), so the
  "Kosmos+ took the family's words, but this computer could not record them" line now follows any family Accept, not
  only a review. An open review panel also closes once the words read as accepted; a non-family review answer reads
  the view again.

## Review 9 (opus) fix
- After org_not_member / org_other_org / org_not_here on a review Accept the record here clears only at the next
  refresh, so the re-read still said wordsNeeded and the words button came back in a loop. The page now holds the words
  back (PLUS_ORG.wordsRefused) until a read says the computer is no longer joined or the words are no longer needed; R8
  asserts the button stays hidden.

## Review 10 (sonnet) fix
- The held-back words outlived the membership: after a refusal, a Leave (no read for a minute after it) and a new join
  whose words were not recorded, the page said "Press Read the family's words" with no such button. A real Leave now
  clears `wordsRefused`; R14 drives that sequence. Review 11: a second clear on a successful Accept was removed, because
  no Accept can follow the refusal without a Leave or a read that clears it first (the join panel needs an unjoined
  page, and the only local write that unjoins it is the Leave), so no arm could tell it apart.

## Review 12 (sonnet) fixes
- With the words held back, the joined sentence still asked a parent to accept them (no button, and the refusal above
  says the account is no longer the family's). It now says only what holds: this computer still shows the family and
  reports nothing to it. R8 asserts it.
- A review answered as not a family's said "Kosmos takes your company's terms on itself", false for a family record; it
  now says Kosmos+ did not answer as a family account and holds the words back like a refusal (R15).
- A Leave sets wroteAt, so a read that started before it cannot put the joined view back.

## Review 13 (opus) fixes
- A review PREVIEW refused because the family no longer names this computer (reviewHere) let the button come back on the
  re-read, the loop review 9 closed for the Accept. reviewHere now gives that refusal a code (`org_not_named`) and the
  page holds the words back on it (R16). The engine test pins the code on both not-named cases.
- Dropping a read older than the page's own write also lost the one-time notes the server spends on that read
  (stoppedFor, leaveRefused). They are now carried to the next read, which runs at once (R17, which also drives the drop).
- The leave-refused line says "reports nothing to the family" while the words are held back.

## Review 14 (sonnet) fixes
- The two real writers of wroteAt (an Accept, a Leave) were driven by no arm: R17 set the time by hand. R18 holds a
  /api/org read open across each and releases it after; the stand-in answers with the state as it was when asked.
- Signing out of Kosmos+ hid the block but kept a family's words on screen and words held back, so signing in again
  within the minute showed them. paintPlus now closes the words and releases the hold in its not-signed-in branch (R19,
  driven through paintPlus with a stand-in /api/remote). Review 15: my first version put this after that branch's
  return, where it never ran; R19 would have been red on the page and its mutant alike.

## Review 15 (opus) fixes
- The sign-out release moved into paintPlus's not-signed-in branch (above).
- `org_not_named` only on a clear answer (no longer a member, another org, named elsewhere); an unclear status gives no
  code, so the words stay offered (the engine test pins both).
- Focus goes to the joined sentence when a review preview is held back, as on the Accept path.

## Weakest premise
That the engine's other review sentences read well to a parent: they are family-worded by inKind (#6251), but only the
page's refusal line is written for this screen. And a family record written before cleanOrg kept `kind` reads as a
company (never wordsNeeded); families are newer than that change, so none should exist.

## Measured
- server.familyreaccept-6239.test.js (3): a family whose words changed is wordsNeeded; the review preview serves the
  family's current words; Accept without wordsShown is refused with nothing sent; with it, the coordinator gets the NEW
  hash and wordsNeeded clears; a company with its words withdrawn is never wordsNeeded; a caller that is not the screen
  never sees the field. Mutant: wordsNeeded forced false, 1 test red.
- docs/browser-checks/render-org-family-6239.js arms F0 to F10 and R1 to R19, chromium and webkit. The runs and full
  validation at the head this ships are recorded in the proof file (`familyreaccept-6239-pre-challenge.md`), not here,
  because any edit to this file changes the head they describe. The last recorded before R14: all pass and full
  validation PASSED (20,885 pass, 0 fail) at 8caa42c877; the R13 mutant reds R13; the R8 mutant (refused words not held
  back) reds R8.
  Page mutants, each red on its own arms: the review refusal back to a fixed sentence (R5, R7, R8, R11); no
  panel-follows-view rule (R7's Leave); a joining family's words not holding the block open (F10). A step that throws is
  a named FAIL (a click that timed out once ended a run with no verdict line). R4 also proves the page
  reads /api/org again after Accept; fixtures carry `kind` as the real route does. Mutants: the words row
  never shown (R1 red); Not now ignoring a review (R3 red).
- Updated pins: web.familywords-6239.test.js lifts plusOrgFamilyNotNow, which now reads PLUS_ORG_FAMILY and calls
  plusOrgPaint/plusOrgFocus (passed in); server.orgenroll-5531.test.js pins /api/org's shape, now with wordsNeeded.

## Not done here
- The rollup still retries a family's automatic re-accept on its backoff, and each one is refused; harmless (it sends
  nothing a parent did not accept) and bounded by the existing backoff.
- Family wording of the joined line after accepting, and of every other org sentence: #6251.
