---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: tiedloop-1621
diff_hash: f13444c551177bc4a9ed270575d9be31899dad0bc4648ffe53dd471461c08e75
subdir_audit: passed
timestamp: 2026-08-30T23:24:52Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review, on a defect in my own merged work

One pair of eyes plus a reviewer who challenged three specific claims in the channel and was
right about two of them. `explicit_override: true` rather than relabelling.

## [BLOCKER] (mine) The guard I merged an hour earlier was blind to the form its bulletin is named after

`for path in`, `select path in` and `read path` all destroy PATH and **none contains an
equals sign**. My shipped sweep checked assignment and declaration only --> FIXED by
enumerating the WRITE positions rather than pattern-matching the one I pictured.

⭐ **The generalisable half: the blind spot is always whichever form your mental model of
"using a variable" defaults to.** Mine defaulted to assignment. That is why the fix is a
reviewable LIST with a named uncovered set (`getopts`, `printf -v`, `mapfile -t`, indirect
writes) rather than a cleverer single regex.

## [BLOCKER] (mine) The declaration pattern was ANCHORED, which is the trap both cards warned about

`f() { local a path b; }` scored 0 on my pattern and PATH-DESTROYED in zsh. **I fixed
anchoring for the assignment pattern and left it in the declaration pattern** --> FIXED.

⭐ Caught only because this branch gives **each position its own planted fixture**. A single
shared fixture would have let three blind patterns hide behind one that worked - which is
precisely how the `for` hole shipped.

## [BLOCKER] (mine) Un-anchoring produced a false positive on real code

`connector-provenance.sh:32` carries the word `path` inside an **error string**. The guard
reported it as writing a tied name --> FIXED: the scan blanks quoted text as well as comments.

⚠️ **This is the other failure direction, and it is not a lesser one.** A guard that fires on a
MENTION gets ignored, and an ignored guard guards nothing. Both directions had to hold
together.

## [STRENGTH] A wrong measurement was caught before it became a wrong conclusion

`select` was nearly recorded as harmless **by two people independently**, because
`select ... done < /dev/null` reads EOF, makes no selection and therefore **never binds the
variable**. It reports STILL-FOUND and looks like proof of safety. Given a real choice
(`<<< "1"`) it destroys PATH like the others.

⇒ **A behavioural arm has to make the code actually REACH the write it is testing**, and a
"safe" result from an arm that never executed the hazard is the reassuring kind of wrong.

## [STRENGTH] The arms show the harm rather than a proxy

Every behavioural arm now runs an external binary (`ls`) instead of asking `command -v`. A
lookup is a proxy; an exec is the harm, and the shell's own words are `command not found: ls`
- exactly what an agent sees when this bites. Adopted from the reviewer's observation that the
strongest arm in the set was not a number.

## Verification

Each of the four write positions planted separately in the tree:

| planted form | guard |
|---|---|
| `x=1; path="/tmp"` | RED |
| `f() { local a path b; }` | RED |
| `for path in a b` | RED |
| `read -r path` | RED |
| `for zzz in` + `mypath=` (untied) | **green, correctly ignored** |

The last row is the one that stops this being a guard that simply always fires.

Full suite: **3213 tests, 3213 pass, 0 fail**, `SUITE rc=0`, with the guard's own 16 lines
inside it. Verified by reading the counts rather than the exit code, because the run was
backgrounded.

**No product code changes.** The two libs fixed in #1632 remain correct; the tree has no
`for`/`select`/`read` write of a tied name today, so this closes a hole rather than fixing a
live defect.
