# remove-confirm-check: teach the OpenAI removal check that removal now asks first

## What finished looks like

`docs/browser-checks/render-accounts-openai.js` passes against a page where
removal is a two-press confirm, AND it goes RED if the confirm is ever removed.
Both halves. A check that merely stops failing is not the goal.

## The problem, measured not assumed

Release 0.6.20 died at step 3b:

```
FAIL  the account leaves the list  ["API key ending WALK Signed in Remove it?"]
FAIL  the answer says the sign-in file is still on the computer
```

#1702 (card #1683, "removing an account asks first") turned removal into an
arm-in-place confirm: first press relabels to "Remove it?", second press acts.
The browser check still pressed once and expected the row gone, so the single
press only armed and both assertions failed.

Confirmed rather than inferred:
- `dfe68b28` (#1702) IS inside the cut's frozen tree `df7486cc`.
- main's check asserts `/^Remove$/` and clicks once.
- The failure text contains the arm label, which only #1702 can produce.

## The decision

**Assert the new behaviour. Do not loosen the check.**

Rejected: pressing twice blindly. It goes green whether or not the confirm
exists, which would leave #1683's entire promise unguarded at the page layer.
That is the same class of defect one layer along: a check that cannot fail.

So: press once, assert the label became "Remove it?" AND the row is still
listed, press again, then make the original assertions.

## Why the "still listed" half is not belt and braces

A regression that ARMS *and also* fires the DELETE leaves the label reading
"Remove it?" for as long as the fetch and repaint take. A label-only assertion
passes on exactly the defect #1683 exists to prevent. The row check is the
property anybody actually cared about, and it costs nothing because the rows
were already being read.

## Why every lookup is scoped to the WALK row

#1659 makes the Claude row live and gives it a `data-forget` button too, and
this fixture can carry a Claude account. An unrooted `querySelector` would
press one account while every assertion here is about another. That is not
hypothetical: #1659 is my own branch and it would have landed into this.

## Known gap, stated rather than hidden

Driving both presses through `evaluate()` never focuses the button, so the
blur-disarm path is structurally unexercisable by this check. `p.click()`
would exercise the real interaction.

- The call: not in this change.
- Why: switching to `p.click()` also invalidates the timing analysis that says
  the 300ms wait is safe. The arming branch is synchronous only because nothing
  focuses. That is a real trade and it does not belong in a change whose job is
  to unblock a release.
- Weakest premise in my own reasoning: that the unit coverage is adequate.
  `web.ask-first-1683.test.js:95` covers blur against a fake button with no
  focus model at all, which is weaker than it sounds.
- What would change my mind: any evidence of a real blur-disarm regression, or
  a quiet moment to make the switch and re-measure the timing.

## Validation

- `tools/browser-checks.sh`: `render-accounts-openai` PASSES first try, no
  retry, with the run at 0 FAILs.
- The repo's own `type-check` and `test` scripts. NOTE: the shared
  challenge-loop 6.0 helper false-reds on this repo because it runs
  `pnpm typecheck` while kosmos defines `type-check`, on a repo with zero
  dependencies. That is a helper mismatch, not a defect in this diff, and it
  hits every kosmos branch.
