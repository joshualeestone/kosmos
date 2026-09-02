# post-body-check-1491: check a body before it becomes Josh-facing text

#1491 names two defects that happen in the same few seconds, between writing a
PR or issue body and posting it. Both are silent.

    gh ... --body "..."   double-quoted, EXECUTES backticks in the body. A
                          backticked function name runs as a command and the
                          literal text is gone. Measured on a real PR: a name
                          written twice appeared ZERO times in the posted body.
    em dashes             nothing swept what we post. Josh's one absolute rule.

## Why a tool rather than another note

The card says it plainly: the backtick remedy was ALREADY in one agent's memory,
with the fix, and it did not reach the agent who hit it.

I am the same evidence a second time. I have that memory. I hit the defect TEN
MINUTES before writing this, closing #1545: a `gh issue comment --body "..."`
whose backticks were command-substituted, and the comment failed outright.

Knowing a failure by name does not prevent it. A command you run does.

## What already existed, checked before building

`engine/create.test.js` has an em-dash guard. It covers ROLE FILES and only the
literal spelling (`—`, 2 hits). Nothing anywhere checked PR or issue
bodies: a grep for `--body`, `pr create` or `issue comment` across the repo's
scripts returned nothing.

## The five spellings, one arm each

A check for the literal character misses four. The one that reached a live pay
screen was the SOURCE ESCAPE inside a string literal, which no
literal-character grep can see.

The tests deliberately use ONE ARM PER SPELLING rather than one file containing
all five: with all five in one file the test passes while four patterns are
broken, because the first hit satisfies it. Proven by perturbation, twice:
disabling the `&mdash;` pattern fails exactly the HTML-entity arm; disabling the
source-escape pattern fails exactly that arm. 10 pass, 1 fail, each time.

## Backticks advise, they do not block, and that is deliberate

Backticks in a body are CORRECT: they are how code is quoted. The defect is
posting with `--body` instead of `--body-file`. A tool that refused good input
would be switched off, and then it guards nothing. So it prints one sentence on
stderr, only when there is something to lose, and still exits 0.

An em dash still decides the exit code even when backticks are present.

## Verification

    all five spellings, one file          5 found, each named, correct lines
    each spelling alone                   caught, one arm each
    a broken pattern                      fails exactly its own arm (x2, measured)
    right line number                     :3: for a dash on line 3
    clean body                            exit 0, stdout empty, stderr empty
    backticks only                        exit 0, advice names --body-file
    backticks plus a dash                 exit 1, both reported
    missing file                          exit 2, not a silent pass
    CONTROL, checker can pass             yes, so a pass is not structural
    suite                                 3131 tests, 3131 pass, 0 fail (3120 before)

Confirmed the tests actually RUN, by name in a full run with a fake-name control
at 0, not by assuming the glob picked them up.

## Usage, one word longer than posting unchecked

    node tools/check-post-body.js body.md && gh pr create --body-file body.md

## Challenge-loop iteration 1 fixes, and one deliberate deferral

Two false negatives were found by a blind pass and fixed, both on the guard path:
the em-dash patterns now tolerate leading zeros (`&#08212;`, `&#x02014;` render as
the em dash exactly), and the backtick advice now also names `$(...)` and `${...}`,
which `--body "..."` executes and expands the same way. Four new test arms.

**Deferred, deliberately, to #1816:** the tool is a manual pre-flight and nothing
invokes it, so #1491's "nobody sweeps PR bodies" is only partly closed. Making the
sweep automatic means wiring it into the `/create-pr` flow or a pre-post hook, and a
mandatory hook runs for every agent on this box (fleet-wide behaviour change, not a
reversible in-lane commit). That is its own review with an awake operator, so it is a
separate card. The tool (the capability) is #1491's deliverable; #1816 owns the
wiring.
