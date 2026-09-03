# report-validate-2001 -- require content for the two report states that summon a person

## The card

kosmos#2001 (found by lilsheila during a CLI sweep; she described it rather than
guessing a fix, because she did not know if the emptiness was intended). `kosmos
report blocked` (and `needs_you`) accepted no `--on`, no `--owner` and no note --
recorded, exit 0, no warning. It compounds with the 0.6.24 free-text bug (#1985):
report's note was optional too, so a needs_you could carry no what, no who AND no
reason -- a completely empty request for help, reported as recorded.

`blocked` and `needs_you` are the only two states that exist to SUMMON A PERSON.
Every other state is informational. A contentless summons renders as a red flag
someone has to chase by hand.

## The decision (mine per Josh's ruling, documented)

The card asked for a decision, not a patch: is a contentless blocked/needs_you
MEANT to be allowed? **No.** Those two states exist to carry what/who/why; a
contentless one is never the intended use.

**Branch A: refuse at the CLI entry, before the network.** `cmd_report` now
refuses `blocked`/`needs_you` (exit 2) unless at least one of `--on`, `--owner`,
or a note has real content. Informational states are untouched.

**Why A over B (make the board render the emptiness honestly):** A prevents the
contentless summons at the point of entry; B admits it and only labels it. The
states exist to carry content, so refusing beats labeling -- and A is the
cheapest correct answer, trivially relaxable. **Not the forbidden warn-and-record:**
a warning printed to a pane nobody is watching is the failure this class produces.

**Why the CLI is the right layer:** `wouldping.js` documents that `needs_you` is
agent-TYPED via the CLI; the CLI is the entry point for typed summoning states, so
validating there is the cheapest correct fix rather than a server change.

**Verified it breaks no caller:** the auto hook sends a note (`needs_you`) or
`--on`+`--owner` (`blocked`), and `engine/defaults.js`'s documented usage always
carries content, so the guard enforces the shape real callers already use.

## The two-iteration loop

1. Implemented the guard (`[ -z "$on" ] && [ -z "$owner" ] && [ -z "$text" ]`),
   dead-port-pinned test with a load-bearing informational-state control, guard
   proven load-bearing by perturbation.
2. **Blind review caught a real hole:** `-z` tests emptiness, not blankness, so
   `report blocked --on " "` (or a whitespace-only note) passed -- a summons that
   "names nothing", the exact thing the guard promises to prevent. Fixed by
   stripping whitespace across all three together (`tr -d '[:space:]'`) and
   refusing if nothing real remains. Added whitespace-only test arms.
3. **Converged:** zero new actionable findings; two non-actionable NITs accepted
   (an NBSP-only value no caller produces; `--until`/`--project` not counting as
   content, which is correct-by-design per the card's "at least one of
   --on/--owner/note").

## Boundaries
- Non-auth CLI validation, so it self-merges on green per the ratified rule
  (self-merge non-auth Kosmos on green; hold auth/code-exec surfaces for review).
- Scoped to `blocked`/`needs_you`; informational states stay free-form.
- The pre-existing typo'd-flag path (an unrecognized `--flag` becomes text via
  `text="$*"`) is out of scope -- #2001 is about the EMPTY summons, and that is
  general arg-loop behavior, not introduced here.
