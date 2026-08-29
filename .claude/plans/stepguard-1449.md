# stepguard-1449: a failed cut must always be able to say where it died

## I re-measured before taking anything, and two of the three asks were already done

```
                       card    now
failed cuts (served=0)   39      42     +3
  carrying step=         22      25     +3
  WITHOUT step=          17      17      0   <- unchanged
```

**All three failures since the card was filed carried a step.** And the stepless set is
bounded in time:

```
STEPLESS:  08-25 (4)  08-26 (8)  08-27 (4)   newest 2026-08-27T05:29:08Z
WITH STEP:            08-27 (9)  08-28 (16)
```

`ac65aea3` ("A cut's completion line says WHICH STEP it died in") is the fix, and
`release.sh:50` writes `step=%s` with `${_STEP:-unknown}` -- a default, so the field is
**never absent, only ever a value**. That is asks 1 and 2.

⚠️ **Checked the commit rather than inferring from the 25-in-a-row streak**, because a
streak is equally consistent with "that failure mode stopped occurring."

## So this is ask 3 only: the regression guard

**Three separate things** make the field unconditional, and a regression need only remove
one, so each is asserted separately:

1. the format carries `step=%s`
2. the interpolation defaults, so an unset `_STEP` cannot render empty
3. `_STEP` is initialised, so a death before step 1 still names one

Plus a **control** that `cut_record_done` exists at all, without which the three would pass
on a file that had been renamed.

## Perturbed, four arms, each with its own message

Remove the format field, the default, the initialiser, or the function: **one failure each,
distinct message each** (the control breaks 14, because other release tests depend on it).
Restores sha-verified. Suite 2942 pass.

## Deliberately static

**`tools/release.sh` is not modified and this test never runs it.** Cuts are active today,
and asks 1 and 2 need no change anyway.

## Residual, which no fix can reach

**The 17 historical lines stay unattributable.** They were written before the field existed.
A retrospective over this log should say "22 of 39 up to 08-27, complete after" rather than
treating the file as one population.
