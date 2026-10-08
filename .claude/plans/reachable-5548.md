# reachable-5548: the #265 guard reads every engine module (kosmos#5548, slice 1 of 2)

## Finished means (slice 1)
engine.reachable.test.js reads the exports of every engine module that has a `module.exports = {` object (was 69
of 253; now 255 of 255 on 3d16f16de), counts a same-file caller only in code, and every export it newly sees is
either excused by name with a reason or on a pending list that can only shrink. A self-test fixture proves the
two blind spots from the card cannot come back.

## Measured (origin/main 3d16f16de)
- Old regex `module\.exports = \{([\s\S]*?)\n\};` read 71 of 255 modules (1,782 names, some of them comment
  words: "and", "rather", "for", "synchronously", and the contents of nested objects such as communitysend _paths).
- New brace-matched read over code: 255 of 255 modules, 3,526 names. Sanity sweep: across 1,524 .js files the
  lexer never blanks a top-level `function`/`const` line except code inside template strings (test stubs).
- Newly visible orphans: 67. 33 are test seams by name and definition (injector or reset whose default restores
  the real one) -> EXCUSED with file. 34 are not seams by name -> PENDING_5548 for slice 2.
- No existing EXCUSED entry went unconsulted.

## Decided
- Slice it (the card asked for a count first). Slice 1 arms the guard for every NEW export now; slice 2 triages
  the 34 (real caller / excuse with reason / delete). Rejected: excusing all 67 with one blanket reason (hides
  real #265 candidates such as projects.setDescription and tasks.parentOf/childrenOf/subtaskProgress); landing
  nothing until all 34 are triaged (leaves the guard blind on 184 modules meanwhile).
- Parse, do not require: engine modules are mostly require-safe, but loading 255 modules in a reachability test
  starts timers and reads the store; a lexer keeps the test pure. Weakest premise: the hand lexer's regex-literal
  rule (a `/` after an operator or a keyword such as return starts a regex). The 255/255 read plus the blanking
  sweep is the evidence; a module it misreads now fails "the guard reads every engine exports block" loudly.
- Cross-file callers are still a plain mention anywhere (unchanged): stripping comments in web/index.html or
  shell files is out of this card's scope and would widen the wave.

## Checks
- engine.reachable.test.js: 4 tests (guard, reads-every-block, pending-only-shrinks, self-test).
- Mutations, each red: drop a pending name (guard); list a non-orphan as pending (ratchet); count comments again
  (ratchet + self-test); restore the old regex (reads-every-block + ratchet + self-test).

## Review 1 (sonnet, blind): NOT CONVERGED, 4 WARNING + 1 NIT
- [WARNING] lexer read `/` after `}`, a postfix `++`/`--`, or `x.return` as a regex start; division there could leave a following comment visible as code (an orphan read as called) --> FIXED: `}` and postfix read as values, a keyword after `.` is a property; fixtures one case per line.
- [WARNING] some definition forms counted as calls: `module.exports.x = name` after the block, `name = function`/arrow --> FIXED (re-export statements blanked; assignment definitions subtracted, declarations not double-counted). Residual, as before #5548: self-recursion, destructured definitions and same-named class methods still count as calls.
- [WARNING] exemptions by name only: a pending name hid any orphan of that name in any module --> FIXED: PENDING_5548 is keyed by file (test "a pending name covers only its own file"); EXCUSED stays by name, as designed.
- [WARNING] modules with no literal exports block were silently unread --> FIXED: NO_LITERAL_EXPORTS names the five with why; the reads-every-block test compares the unread set to it.
- [NIT] generator/quoted/computed keys skipped --> recorded; the old regex skipped them too.
- Correction to "255 of 255": 260 engine files, 255 with a literal block; the other five are now named.
Mutations re-proven red: `}` as regex start; no postfix rule; no dot rule; re-exports counted; pending by name only.

## Review 2 (opus, blind): CONVERGED (nothing above NIT)
Reviewer compared codeOnly to a real tokenizer (acorn) over all 774 engine/*.js files: 0 disagreements either way
(no comment/string/regex word kept as code, no code token blanked). Folded:
- [NIT] path.join keys would be backslashed on Windows --> FIXED (path.posix.join for keys).
- [NIT] a regex at the start of a template ${} read as division --> FIXED (afterOpen) + fixture.
- [NIT] the 33 seams excused by generic names (setClock, setBin, _lock) would hide a same-named orphan elsewhere --> FIXED: SEAMS_5548 keyed by file, plus a test that each is still exported there.
Recorded for slice 2 (not folded): cross-file callers still count a comment mention (codeOnly could apply to the JS caller files); exports added by Object.defineProperty(module.exports, ...) (chat.js DRY_RUN, VERIFY_FORMAT; store.js loop) are invisible.
Mutations re-proven red: no afterOpen (self-test); a seam keyed to the wrong file (guard + seam ratchet).
