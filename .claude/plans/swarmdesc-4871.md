# swarmdesc-4871: no role descriptor under the menu on the Create a Swarm path

Card: joshualeestone/kosmos#4871. Josh, #admin, 2026-10-01 07:19 CDT: "On the "Create a Swarm" page I don't want the extra
descriptor underneath "Picking a Role."" (screenshot: Office Manager, "It drafts customer messages and plans; nothing goes
out without the owner.").

## Change
web/index.html paintPickLimit: on the swarm path (CREATE_PATH === 'swarm') the line under the Role menu (#pick-limit,
the role's `caution`) is not shown, EXCEPT a professional-advice disclaimer (not a lawyer; not financial, tax, medical or
veterinary advice; not an accountant/adviser). The single-agent path is unchanged.

## Decided, not missed
- The box is the role's `caution`, not a blurb. Josh, 2026-08-10 (engine/roles.js), shipped Legal on the condition that
  its limit is visible "when they pick it out ... same with the other roles we greyed out". So the call honours both: the
  operational lines go (41 of the live catalogue's 63 cautions, Office Manager's included); the 22 professional-advice
  disclaimers stay, plus the built-in legal, finance and books. Josh can say "all of them" and it is one line.
- Rejected: hiding every caution on the swarm path (drops the Legal condition silently); a per-role flag in the catalogue
  (a catalogue change in another repo for a copy call; the pattern is on the words that make the disclaimer).

## Weakest premise
That a word pattern sorts disclaimers from operational lines. Measured on the live catalogue (listed in the card
comment); a future caution that disclaims advice in other words would be hidden on the swarm path only.

## Tests
web.role-picker.test.js: the swarm path hides Office Manager's line, single keeps it, and six advice disclaimers stay on
the swarm path. Mutations: dropping the swarm rule reds it; dropping the advice exception reds it.

## Review rounds
- Round 1 (opus): FIXED W: the advice pattern erred toward hiding; widened (counsel, legal, tax, financial planner,
  doctor, physician, clinician, therapist, diagnos*, veterinar*), five new wordings pinned in the test; still 22 of the
  live catalogue's 63 kept (no new keeps, so no operational line is kept by it). DEFERRED W: the partial removal is the
  documented call on #4871 with a one-line reversal for Josh. FIXED NIT: the needless typeof guard.
- Round 2 (sonnet): FIXED W (same class as round 1): plurals and professions the list missed (CPA, auditor, nurse,
  pharmacist, psycholog*, psychiatr*, dentist, licensed, "taxes", "lawyers"); five more wordings pinned. Still 22 of 63
  on the live catalogue. FIXED NIT: an accepted false keep is pinned in the test, so keeping an operational line that
  names a professional word is a decision, not an accident. Left NIT: hoisting ADVICE (the test slices the function).
- Round 3 (opus): DUPLICATE W (round 1's partial-removal call), with a new action taken: the card now states "done means
  (as built)" so a check against its wording does not reopen it. FIXED NITs: the pattern's noun stems are open
  (advis*, legal*, counsel*, medic*, therap*), five more wordings pinned, still 22 of 63; a stale buildPicker comment
  that said the limit is also shown on a later step now names #pick-limit as the only place.
- Round 4 (sonnet): FIXED W: paintPathOptions now calls paintPickLimit, so the path-keyed line does not depend on a
  later loadRoles paint. DUPLICATE W: the word pattern (the named weakest premise). FIXED NIT: the .rolelimit CSS comment
  that still said the last step is the only place a caution shows.
- Round 5 (opus): DUPLICATE W (the partial-removal call; it goes to Josh through Splinter with the card comment).
  FIXED W: the paintPickLimit call in paintPathOptions is pinned in the test; deleting it reds the test (mutation run,
  file restored and cmp-verified; the browser run in flight was frozen at aab1af746 and could not see it).
