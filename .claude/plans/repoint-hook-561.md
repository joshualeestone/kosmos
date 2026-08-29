# repoint-hook-561: an entry of ours pointing at the wrong copy is not "already wired"

## The measurement, on the real machine

```
ensureWired(live ~/.claude/settings.json, correct script)
  -> {"wired": true, "changed": false}
  entries now pointing at the correct script : 0
  entries still pointing at the Aug-26 copy  : 7

CONTROL, same call on a settings file with no hooks
  -> {"wired": true, "changed": true}   seven entries written
```

**It reported SUCCESS having changed nothing, for a script it had never seen.**

## Why

`entryIsOurs` matches the **filename**, and every copy of the script carries the filename.
So an entry aimed at a hand-placed copy anywhere on disk reads as correctly wired, and
`if (existing.some(entryIsOurs)) continue;` skipped it.

⇒ **`setup.sh` re-runs this on every update, so the product's self-healing path could not
heal the one thing it exists to heal, and said it had.** That is why #1467's stale hook
survived every update since Aug 26.

## The change

An entry that is **ours** but names a different script is **repointed**. It is ours by the
marker, so replacing it is not clobbering somebody's configuration. Only our entries are
replaced; anything else in the same event's list is untouched.

Already-correct entries are left completely alone, so a second run is a no-op and a
person's `timeout` or `matcher` edits survive.

## Perturbed, both arms

- Restore the original skip: the repoint test **and** the control fail.
- Replace the whole list instead of only our entries: **only the control** fails, which is
  what makes that control load-bearing rather than decorative.

Suite 2921 pass, 0 fail, three more than main's 2918.
