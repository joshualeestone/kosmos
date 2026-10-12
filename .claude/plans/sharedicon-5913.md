# kosmos#5913: reuse another account's shared sealed icon instead of making a second one

Rebuilt 2026-10-12 from the branch's commit history (the working draft was lost with a session restart).

## The change
- A sealed Kosmos.app install on a Mac with a second account reuses the shared icon another account already
  installed, instead of making a second one. A reader (`sealed_icon_other_users "$owner_uid"`) answers whether
  another user's install still uses the shared icon; uninstall removes the icon only when it exits 1 (no other
  user), and keeps it otherwise, saying so.
- A marker (owner-only, holding a hash, linked into place atomically) names which install owns the icon. A
  directory at the marker name is refused.
- The installer's runnable guard (#1716) read the reader's folder searches (`[ -x P ]` on a folder) as
  runnable-program tests. It now lists each folder search test by name (FOLDER_SEARCH_TESTS: file, the exact
  code line before, the exact line), excused exactly once (`-v whole=1`); installer files must exist and awk
  must exit 0; scratch files live in one TMPDIR removed by an EXIT trap.

## Review history (blind rounds)
- Rounds 1 to 5 (the change itself): sandbox gates, a fail-safe reader, removal only after the marker; no removal
  of an own second icon; marker hash and owner-only mode; atomic link; every dot-name counts. Round 5 converged.
- Validation at a190bf4a5 then failed only on tools/test-installer-runnable-guard.sh (#1716), which started
  rounds 6 to 18 on the guard.
- Rounds 6 to 11 narrowed a shell grammar (order, per -x gate, command start, keywords, comments, quoted #); each
  round found another shape a line scan cannot parse.
- Round 12 replaced the grammar with a by-name list. Rounds 13 to 17 hardened it (per-file key, exactly once,
  missing files fail, controls that can fail, EXIT-trap scratch, honest control labels).
- Round 18 converged. Its one concern: gawk unmeasured (macOS awk and mawk pass).

## Decided
- By-name listing over a grammar: a line scan cannot judge shell, and two call sites do not justify a parser.
  Weakest premise: a future folder test must be listed by hand; the guard goes red until it is, which is the
  safe direction.
- Angel's PR #5989 (#5986) rewrites the same guard's scan: whoever lands second wires the other (agreed).

## Not covered
- A real two-account Mac run (reasoned from the reader's tests, not measured on two accounts).
- gawk.

## Merge with main (2026-10-12 evening): #5912 and #5986 landed first
- As agreed with Angel, the second to land wires the other. `shared_sealed_stays` (#5912) removes this account's
  icon only when `sealed_icon_other_users` also exits exactly 1 (no other account); every other exit keeps it.
- The uninstall note says why the icon stays: this account's main install still opens it; another account may use
  it; or (sealed_left_note) whose icon it is, cautious when the owner cannot be read.
- This account's reuse marker is taken back LAST, just before the uninstall's only exit 0, so a failed uninstall
  keeps it.
- The runnable guard keeps #5986's scanner, with the by-name folder excuse grafted in (key: file, code line before,
  trimmed line; positive bare -x only; each listed test found once; the line-before reset runs before the comment
  skip, so it holds on files that start with #!).
- Merge reviews: round 1 (opus) a stale shell-test sentence, a note that could invite trashing an icon, the reset
  order; round 2 (sonnet) the marker taken at the start of a possibly failing uninstall; round 3 (opus) two order
  tests that anchored on the note's identical elif. All fixed with measured mutants. Not taken: a behavioural test
  of the three notes in tools/test-install.sh (the slow suite's job; the weakest premise of the merge).
- Validation before the merge: 2 failures in 19593, both timing tests in files this branch does not touch, both green
  alone on the branch and on main (contention).
