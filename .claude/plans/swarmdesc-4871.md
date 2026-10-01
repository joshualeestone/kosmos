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
