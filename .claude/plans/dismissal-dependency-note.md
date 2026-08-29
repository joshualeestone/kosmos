# dismissal-dependency-note: a dismissal is a dependency, recorded where it will be read

## The rule, and it is Splinter's

> *"When a reviewer writes 'happens to fail safe' or 'moot because X', THAT IS A
> DEPENDENCY, NOT A REASSURANCE, and it should be recorded on X's OWN CARD, where
> whoever fixes X will see it."*

**Renet hit the live version of this today:** a reviewer waved off a
path-interpolation bug as *"moot today"* because the call producing the path
could never resolve. **Renet then fixed that call.** The bug went live and
nothing flagged it.

## My two

`.claude/plans/acctdup-named-pre-challenge.md` deferred two findings as
**unreachable**, and both dismissals rest on a property of one function,
`accountQualifiers`'s `key()`:

```
8  the ambiguity count is blind to a name derived from a label or dir
   moot only while every row yields a key from email or keyTail
9  the default dir is not added to the used-set
   moot only while there is exactly one default
```

**Re-measured on this machine today:** 4 accounts, all with an email containing
`@`, dirs and labels unique, exactly one default. **Both still moot.**

## Where the note goes, and why not the card

There is no card for `accounts.list()`, so "record it on X's own card" has
nowhere to land. **The code at the condition is the next best place and arguably
better: it is what whoever changes it actually opens.**

⇒ The comment names both findings, states the condition each depends on, and
says what makes them live: **a row that yields neither an email nor a keyTail
gets `''`, is not counted, and finding 8 becomes real with nothing failing.**

## Why this is worth a commit rather than a note to myself

**Only I would ever have found those two**, and only because Splinter asked me to
go looking. **A dismissal that lives in a merged review file is invisible to the
person who makes it wrong.**

Comment only. Suite 3012 pass, 0 fail.
