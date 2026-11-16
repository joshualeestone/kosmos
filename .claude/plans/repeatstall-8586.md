# repeatstall-8586: follow-ups from #8581's review (repeat tells)

Card: kosmos#8586 (filed by Ice Cream Kitty from #8581's review at the 8-round cap; handed to Angel 11-16 12:40,
Fleet Builders m4415). Built on main after #8581 merged (63b68ce876).

## Done looks like

1. A repeat whose holder is off the project writes ONE "could not reach" history row per stall, not one per slot;
   the same for the missed-run tell's unreachable reviewer (off the project, or switched off in it).
2. A holder who is also the named reviewer is told by the due-run tell when the missed-run tell does not take that
   slot (a slot missed before the reviewer was named), so no slot falls between the two.
3. and 4. decided below.

## Item 1: once per stall (engine/repeatdue.js, engine/missedtell.js)

- The first unreachable slot is recorded as today (history row, told mark). The task also keeps a small stall mark:
  `repeatDueQuiet` / `missQuiet` = `{ who, at }`, where `who` is the sorted holders (repeatdue) or the reviewer plus
  the reason, off or switched off (missedtell).
- A later slot is not recorded while the mark holds: same `who`, no run since `at`, the rule not changed since `at`
  (and, for missedtell, the reviewer not renamed since `at`). The sweep still reports it (`recorded: false`).
- Any other outcome (a delivery, reached or not) clears the mark, so a holder who came back, was told, and left
  again starts a new stall.
- Rejected: storing the mark in the sweep's in-memory book (lost on restart, which is when duplicates appeared);
  skipping in owed() (owed() has no project members for the reviewer case, and the sweep is where "unreachable" is
  decided).

## Item 2: the reviewer-holder gap (engine/repeatdue.js)

The holder who is also `repeatReviewer` is excluded from the due-run tell only when `missedtell.owed()` takes this
task and slot, or the missed-run tell already told it (`missToldAt >= slot`). Asking missedtell's own owed() means
the two sweeps cannot disagree about whose slot it is.

Known residual: a minutes-repeat whose missed-run tell is held by its hourly stall gate is told here instead for
that slot, so such a holder can get one due-run line and, an hour later, one missed-run line. Both are true.

## Item 3 (optional stale-repeat mark in the task list): NOT built here

It needs a new field in the task list across the CLI, the board and the iPhone app, which is a feature, not a
follow-up. The card calls it optional. Left on the card as its own item for whoever picks up the task list next.
Weakest premise: that nobody needs it before then; the due-run tell (#8581) already tells a holder each due slot.

## Item 4 (TELL_TYPED for future Prompter-off sweeps): no change

Today no sweep that runs with the Prompter off lacks the map (hold-stale and the reply nudge need the Prompter on).
The card says "if a future sweep runs with the Prompter off, give it the same map": there is no such sweep to change.
Recorded on the card so the next sweep's author sees it.

## Tests

engine/repeatdue-8581.test.js and engine/missedtell.test.js gain #8586 tests, each with a control in the same
test that IS recorded or told. Mutation: with stillQuiet() returning false and the item-2 filter reverted, all three
new tests fail (44 pass, 3 fail); with the change, 47 pass. Focused run plus the standing guards: 94 pass.
