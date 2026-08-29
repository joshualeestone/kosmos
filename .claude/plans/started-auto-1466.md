# started-auto-1466: the seventh report call, and a control that could not see it

## The defect (Renet Tilley's card)

`#1453` swept the hook to pass `--auto` on every report call. **Six of seven got it.** The
seventh is the synchronous delivery check, written as a command substitution:

```sh
STARTED_OUT=$("$KOSMOS" report started 2>&1)
```

⇒ **Every machine-written `started` recorded as `by: 'agent'`**, on the one lifecycle event
that fires in every session.

## 🛑 And the guard could not see it, which is the part worth keeping

`report-hook-auto-1453.test.js` had two patterns and treated their agreement as proof of
completeness. **They shared one separator class**, and the character before `report` in a
substitution is the closing quote of `"$KOSMOS"`. Neither `(` nor `"` was in the class.

**Both read 6. Both were blind to the same thing. Their agreement carried no information.**
The floor was 6 as well, derived from what the pattern found rather than from the real count.

⭐ **Two patterns built on one mechanism cannot disagree about that mechanism's blind spot.**

## What this does

1. `--auto` on the substitution call. Seven of seven.
2. **The count-agreement control is replaced by a CLASSIFICATION.** Every `report` followed
   by an argument gets a kind: call / probe / forwarder / variable-state / unclassified. A
   shape nobody anticipated lands in `unclassified` **by default** and fails printing its
   own text. Three attempts at "a looser regex" all failed the same way first, each
   disagreeing with `CALL` for reasons that were not defects.
3. Floor re-derived from the real call count: 6 to 7.
4. The header table was **split**, with `StopFailure` and `SessionEnd` orphaned below the
   prose, which is how "EVERY line above passes --auto" was true of five rows and false of
   seven. Table reunited, counts corrected.
5. `engine/selfreport.test.js`'s sibling claim corrected: it asserted a shape the hook did
   not emit.

## Renet's open question, answered

**Nothing branches on `selfreport`'s `by`.** Written at `selfreport.js:161`, read at `:260`,
and no consumer reads it (`tasks.js` and `projects.js` carry unrelated `by` fields). So this
corrects the record and changes no behaviour.

## Perturbed, five arms

The #1466 defect itself, an inline case-arm call, a variable state, a NEW call in a command
substitution, and a wholly novel shape. Each fails the right test; the novel shape prints
its own token. Restores sha-verified. Suite 2938 pass, 0 fail.
