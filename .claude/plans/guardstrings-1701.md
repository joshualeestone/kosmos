# guardstrings-1701: two of my own controls were one rewording from meaningless

Follow-up to my merged #1701, prompted by Splinter reporting the same shape against a colleague's live PR.

## The defect, in my own merged work

`engine/create.blockdrop-1673.test.js` asserts the ABSENCE of three warning phrases. Only one is paired with a PRESENCE assertion on the same phrase:

```
'operating instructions'   match @82  AND  doesNotMatch @107   protected
'reports-to section'       doesNotMatch @108 ONLY              EXPOSED
'section about you'        doesNotMatch @109 ONLY              EXPOSED
```

**An absence assertion whose phrase no longer exists passes vacuously.** Reword either warning and the control goes green having tested nothing.

## Demonstrated rather than argued

Reworded exactly one phrase in `engine/create.js` (`reports-to section` -> `manager section`), as a colleague would in a rebase:

| | result |
|---|---|
| the old `doesNotMatch` control | **STAYED GREEN** |
| the new guard | **went RED** |

⇒ The control that exists to catch a change in this area **did not catch it**. Only the new assertion did. That is the whole case for this PR.

## Change

One test asserting the three phrases still exist in `engine/create.js`, with a negative control (a phrase the product has never contained must not be found, or `includes` is matching anything).

## What this does NOT fix, stated plainly

Those two controls run in a scenario that **never reaches the `reports` or `you` appends at all** (no manager, no `you` record), so they assert the absence of warnings that **could not have fired**. True by construction rather than because the fix works.

⇒ **This guard makes them fail loudly on a rewording. It does not make them strong.** Closing that properly needs a fixture with a manager and a `you` record, which is a larger change and is not attempted here.

## Pacing

Splinter asked for this to be carded rather than shipped tonight, during a live release run. **Opening the PR rather than only a card so the proven diff is not lost, and not merging it.** It is test-only and can land whenever the run is quiet.
