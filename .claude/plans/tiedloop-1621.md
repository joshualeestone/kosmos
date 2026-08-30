# The zsh-tied-name guard was blind to iteration, which is the form the bulletin is named after

**Branch:** `tiedloop-1621` · Follow-up to **#1632** (cards #1621 and #1620), which I merged
about an hour before finding this.

## What was wrong with the guard I shipped

`tools/test-zsh-tied-names.sh` checked two syntactic positions, **assignment** and
**declaration**. It was blind to:

```
for path in a b c     NO EQUALS SIGN ANYWHERE.  measured: PATH DESTROYED
select path in a b    likewise                  measured: PATH DESTROYED
read path             likewise                  measured: PATH DESTROYED
control: for zzz in                             measured: survives
```

⇒ **I was searching the syntax of ASSIGNMENT while the hazard lives in ITERATION**, and the
fleet bulletin for this class is literally called `zsh-tied-array-loop-var`. The guard passed
a tree containing the exact form its own subject is named after.

**The general form, which is the part worth keeping:** when sweeping for a variable,
**enumerate the syntactic positions that WRITE it** before choosing a pattern - assignment,
`local`/`declare`/`typeset`, `for X in`, `select X in`, `read X`. A pattern keyed on one is
blind to the rest, and the blind spot is always whichever form your mental model of "using a
variable" defaults to. It is a LIST rather than a cleverer single regex because a list can be
reviewed for what is missing.

## Three more holes, each found by a control rather than by review

- **The declaration pattern was ANCHORED to line start**, so `f() { local a path b; }` scored
  0 while zsh scored it PATH-DESTROYED. **This is the same anchoring trap #1620 and #1621 both
  warned about** - I fixed it for the assignment pattern and left it in the declaration one.
  Caught because this branch gives **each position its own planted fixture**, so no pattern can
  hide behind another that works.
- **Un-anchoring it then produced a FALSE POSITIVE** on a real file:
  `connector-provenance.sh:32` has the word `path` inside an error **string**
  (`"${1:?connector_provenance needs the connector path}"`). ⇒ The scan now blanks quoted text
  as well as comments. **A real write survives the blanking, because the NAME sits outside the
  quotes in every form that matters.**
- **`select` was nearly recorded as harmless, by two people independently.**
  `select ... done < /dev/null` reads EOF, makes no selection, and therefore **never binds the
  variable**, so it reports STILL-FOUND and looks like proof. With a real choice (`<<< "1"`)
  it destroys PATH like the others. ⇒ **A behavioural arm has to make the code actually REACH
  the write it is testing.**

## Scope

**No product code changes.** The two libs fixed in #1632 remain correct; this is entirely the
guard and its controls. The tree has no `for`/`select`/`read` write of a tied name today, so
this closes a hole rather than fixing a live defect.

**Weakest premise, named:** the position list is mine and it is not proven complete. The file
now names what it does NOT cover - `getopts`, `printf -v`, `mapfile -t`, and indirect writes
through `eval` or a nameref - rather than implying the four are exhaustive.

**What would change my mind:** any of those appearing in the tree, at which point each needs
its own pattern and its own planted control.

## The arms show the harm, not a proxy

Every behavioural arm runs an external binary (`ls`) rather than asking `command -v`.
**A lookup is a proxy for the harm; executing something IS the harm.** The shell's own words
are `f: command not found: ls`, which is exactly what an agent sees when this bites and why it
reads as a broken machine rather than a broken script. Adopted from a reviewer's observation
that the strongest arm in the whole set was not a number.

## Verification

Each of the four write positions planted separately in the tree and the guard **red on each**;
an untied name (`for zzz in`, `mypath=`) correctly ignored. Every behavioural arm is paired
with an untied control, and the arms use `case` rather than `=` because zsh's `select` prints
a `?#` prompt into the captured output, which a bare equality comparison fails on.
