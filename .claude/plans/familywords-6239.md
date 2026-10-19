# familywords-6239 (kosmos board half of kosmos#6239's slice 2: under 13)

Card: joshualeestone/kosmos#6239 (plan comment 2026-10-15 14:1x CDT). Coordinator half: kosmos-relay branch
familykind-6239 (org kind, a family's words, a family joins only with wordsShown).

## What this branch does
1. `engine/orgenroll.js`: `cleanOrg` keeps the org's kind ('family', else 'company'; an older coordinator sends none);
   `NAMES_POLICY` also reads "version of the family's policy"; enroll sends `wordsShown: true` only when the caller
   says the words were shown AND it sends the hash of those words.
2. `engine/agentevents.js`: the events line may say "stopped by the family's rules" (EVENTS_CONSENT_PHRASES).
3. `server.js` `/api/org/*`: the preview ticket remembers a family; an accepted enroll for a family's ticket without
   `wordsShown` is refused before the ticket is spent (org_family_words_unseen), so the person can read and accept;
   the page gets the org's kind (never its id).
4. `web/index.html`: Connect stops after a family preview and shows the family's words (`#plus-org-family`, text only),
   Accept and join enrolls with wordsShown, Not now and Cancel close it. A company still joins at once (#5791).

## Decided
- This reverses #5791 (Josh 10-10 14:32: "no consent preview: the company decided") for FAMILY accounts only, because
  a parent's consent is the point of a family's join (Josh 10-15 10:42). Company joins are unchanged.
- The pings need no change: `engine/createdbeacon.js` payload is already pinned to {installId, count, version, os,
  guide} (+ internal) by createdbeacon-3038.test.js, nothing about a person (Josh 10:45).
- One kid per computer in v1 (a board has one person, engine/you.js).

## Round 1 (opus) fixes
- Focus goes to the family's words (the lead, `tabindex="-1"`, the panel a labelled group), never to Accept first;
  Not now and Escape inside the panel return focus to the code field; a new code, or reopening, closes old words; a
  ticket that ran out closes them; copy with no org name or no readers no longer reads oddly.
- `reacceptWords` copied its caller's options into its enroll, so an automatic accept could say the words were shown:
  it now sets `wordsShown: false` (found by the new test; mutation-proven, as is the no-hash guard).
- org_family_words_unseen has its own sentence (SAY).

## Round 2 (sonnet) fixes
- Not now and Escape do nothing while Accept is in flight (the join may already have happened; it no longer says
  "Nothing was joined" over a join that went through); a join clears the message line and puts focus on the joined
  view's sentence. One sentence for org_family_words_unseen on the route and the engine.

## Round 3 (opus) fixes
- The panel shows every part of the words the parent accepts: the backup lines too (or the family's own "Nothing is
  backed up."), with empty headings hidden. Before this, Accept said the words were shown while backup lines were not.
- Any refusal with a code (which spends the ticket) closes the words; org_bad_world (which keeps it) does not.
- Another code typed over the words closes them; the panel's label is short ("The family's words").
- Decided, not changed: the never line shows the family's own list (the coordinator always sends "keys and
  passwords"); with none, nothing is invented.

## Not done here
- What `wordsShown` proves: the screen's request says the words were shown, as strong as isViaScreen (no agent token,
  a same-origin header), the same as #5791's ticket. A local process that leaves its token off could claim it. And it
  cannot tell a parent from a child at the keyboard. Both for Josh and the lawyer before anything public.
- The joined view (GET /api/org) does not carry the kind yet; #6251 needs it for the family wording.
- When a family's words change, the board's automatic re-accept (reacceptWords) cannot accept for the parent (the
  coordinator refuses it without wordsShown), so reports stop until a parent reads them: Settings has no screen for
  that yet (#5791 removed the review screen). Fails closed; a follow-up.
- Family wording of Settings' join/leave strings: #6251. The lawyer reads the family words before anything public.
- No browser check drives the family panel (a page test runs its functions against a stand-in document).

## Validation
- New: engine/familywords-6239 (3), server.familywords-6239 (2), web.familywords-6239 (3); every change
  mutation-proven red (6 engine/server and 2 page, then 2 more in round 1). Org-related neighbour tests: 499 pass (two pins of the org shape
  now include its kind).
