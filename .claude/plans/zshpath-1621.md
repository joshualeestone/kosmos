# #1621 and #1620: no shared shell lib may use a zsh-tied name

**Branch:** `zshpath-1621` · **Cards:** kosmos#1621 (superset) and kosmos#1620, taken together
because they are the same defect in the same file and one rename closes both.

## The defect

zsh **ties** four variables to their array forms: `path`, `cdpath`, `fpath`, `manpath`. A
scalar `local path` therefore **destroys PATH for that function's dynamic scope**, and every
command it calls dies with `command not found`. **The declaration alone is enough**, which is
why the observed failure landed on line 2 of `_site_left_behind` rather than at its `path=`
twenty lines below.

It only bites when a lib is **sourced**, not executed. Under bash these files were correct,
and they are normally executed. It bites the agent who reaches for `source` to reuse one
helper, and **the symptom reads as a broken machine rather than a broken script**.

## The three sites, found with two patterns because one cannot see the other's shape

```
tools/lib/disk-guard.sh:17    local need="$1" path="$2" ...        assignment in a decl list
tools/lib/site-deploy.sh:148  local ... line path kind ...         a BARE name
tools/lib/site-deploy.sh:167  kind="${line:0:2}"; path="${line:3}" assignment after a semicolon
```

`path` -> `where` in the disk guard, `path` -> `entry` in the site deploy. Both are locals in
one function each, so the rename is contained. `cdpath`, `fpath` and `manpath` do not appear
anywhere in the tree; I checked all four rather than only the one that was reported.

## The grep trap, taken as a requirement rather than a footnote

Both cards warn that an anchored search misses this, and both real sites are mid-line. My
sweep is unanchored, uses `find -print0 | xargs -0` so a non-matching glob cannot abort it and
report a clean zero, and carries a control. **`tools/test-zsh-tied-names.sh` asserts the trap
directly**: the anchored pattern MUST fail to find a planted offender, so the file records why
the unanchored form is not merely equivalent.

## What I got wrong

**My guard failed on its own documentation.** A detector has to spell what it detects, so the
four names appear in its grep patterns and its planted fixture; run against itself it reported
five offenders on a clean tree. Fixed two ways: full-line comments are stripped before matching
(so any lib documenting the hazard is not read as committing it), and the file excludes itself.
**The exclusion's cost is stated in the file** - a real offender written into that file would
not be caught - and it is accepted because it is a test, never sourced.

## Why the guard has behavioural arms and not just a grep

A sweep proves the string is gone. It does not prove the hazard is. So the test also sources
the fixed lib into a real `zsh -f`, calls the function, and asserts `mktemp` is still findable
- **and pairs it with a control that runs the OLD shape in the same zsh and asserts PATH is
still destroyed.** Without that control, `SURVIVED` is equally consistent with a check that
never exercised the hazard.

**Weakest premise, named:** the behavioural arms `SKIP` where zsh is absent, so on such a
machine only the grep arms run. That is stated in the output rather than hidden, but a green
there is a weaker green.

## Release-path safety, since these cards raise it

#1621 asks for an owner who will not collide with a cut. Checked with the repo's own
`tools/lib/cut-guard.sh` rather than a name-keyed `ps | grep`, all arms: real rc=0, its
`KOSMOS_CUT_PROBE` seam rc=1 (so it can refuse), a probe exiting 3 rc=1 (cannot-answer is a
refusal), browser-run guard rc=0. **Re-checked immediately before pushing**, because a
precondition verified once at the top of a long task is a stale precondition.

📌 And per `release-freeze.sh`'s own notice, there is no merge freeze: a cut freezes at a sha
and builds from its own tree, so it is not reading this worktree.

## Not done

The workaround the card suggests (`bash -c '. lib; fn'`) is no longer needed for these two
libs and I did not document it as a standing practice, because the point of the fix is that
sourcing is now safe.
