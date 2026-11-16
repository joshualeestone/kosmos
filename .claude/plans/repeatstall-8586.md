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
  `repeatDueQuiet` / `missQuiet` = `{ who, at }`, where `who` is every holder of an open part not switched off,
  sorted, taken before the reviewer-holder filter of item 2 (repeatdue), or the reviewer plus the reason, off or
  switched off (missedtell). So switching a holder on or off, or another holder joining, is another stall.
- A later slot is not recorded while the mark holds: same `who`, no run since `at`, the rule not changed since `at`
  (and, for missedtell, the reviewer not renamed since `at`). The sweep still reports it (`recorded: false`).
- markTold recording any other outcome clears the mark (a delivery that reached, one given up after MAX_TRIES,
  or for missedtell the person-as-reviewer row), so a holder who came back, was told, and left again starts a new
  stall. One who came back and was never told before leaving again is still in the first stall.
- Rejected: storing the mark in the sweep's in-memory book (lost on restart, which is when duplicates appeared);
  skipping in owed() (owed() has no project members for the reviewer case, and the sweep is where "unreachable" is
  decided).

## Item 2: the reviewer-holder gap (engine/repeatdue.js)

The holder who is also `repeatReviewer` is excluded from the due-run tell for every slot from the moment the
reviewer was named (`repeatReviewerSetAt`), which is the missed-run tell's own rule for whose slot it is, and told
by the due-run tell for a slot missed before that.

Rejected (it was the first version, review round 5 found it): asking `missedtell.owed()` whether it takes the slot
right now. For a minutes repeat its hourly throttle answers "no" for most slots of a stall, so the reviewer-holder
was told by both tells every hour. The rule decides whose slot it is; the throttle only decides when that tell
speaks.

## Consequence of not advancing the told mark during a quiet stall (both modules)

For the slots that are not recorded, `repeatDueToldAt` / `missToldAt` stay on the stall's first slot. So owed()
offers the task on every sweep while the stall lasts (a result entry, no write and no roster read), and when the
holder or reviewer comes back the existing stall throttles count from that first slot, so they are told as soon as
the throttle allows counted from the stall's FIRST slot (for a 15-minute repeat: the fourth slot after it), never
later than if every slot had been recorded. Measured, not reasoned: "a minutes repeat's holder who comes back
mid-stall is told when the throttle from the stall's first slot allows" (not at 11:25, told at 12:05). A holder who comes back
but is never told (not idle, not running) keeps the mark, so leaving again writes no new row: still the first stall.

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
test that IS recorded or told. Mutation (measured once): with stillQuiet() returning false and the item-2 filter
reverted, the #8586 tests that existed then failed and every older test passed. tasks.repeat-4787.test.js now
seeds both stall marks before checking that stopping a repeat and changing the reviewer drop them.
