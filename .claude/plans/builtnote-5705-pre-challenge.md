---
pre_challenge: true
method: challenge-loop
branch: builtnote-5705
diff_hash: ea317290f7abf873eef173cb8828589b4ad6dbc5b104804504dabf6c98958b35
validation: passed (rebased on origin/main and re-run; engine/tasks.builtnote-5705 4/4, server.task-built-3951 12/12 through the real route and both commands, engine tasks suites, help-lines, the Windows 570 and gaps suites, file-scanning, Windows and engine.reachable guards 0 fail; red by mutation: the check removed, the person exemption removed, double quotes restored, the Windows message cut, the format-character strip removed)
subdir_audit: passed
timestamp: 2026-10-09T19:30:10Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet; each blind)
**Converged:** Yes (iteration 4: nothing above NIT; one NIT taken because it changed stored text)
**Total findings:** 0 BLOCKERs, 6 WARNINGs, about 8 NITs
**Fixed:** the WARNINGs except two documented gaps, and most NITs | **Asked (awaiting user):** 0

The change (kosmos#5705 part 1, user feedback: a task stayed built though nothing was done): an agent's built mark on
a task with done-when checks must carry a note on how they went; a bare one is refused and writes nothing.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] the Mac command cut the refusal at its first double quote --> FIXED (single quotes; Mac test asserts the whole sentence).
- [WARNING] an agent can clear agent-set checks and then mark bare --> LEFT, documented in the plan as a known gap.
- [NIT] the note refusal came before the person-mark one --> FIXED.

#### Iteration 2 (sonnet)
- [WARNING] the Windows refusal was untested --> FIXED (exit 1 and the whole sentence; red by mutation).
- [NIT] the example named a second check on a one-check task --> FIXED.

#### Iteration 3 (opus)
- [WARNING] an agent presenting as the screen gets the person's mark (older than this change) --> LEFT, named in the plan in general terms.
- [WARNING] a note of only zero-width characters passed --> FIXED.
- [WARNING] the refusal order was untested --> FIXED.
- [CONVENTION] help said "what is left" --> FIXED on both commands. [NIT] a full stop after the command --> FIXED (in brackets).

#### Iteration 4 (sonnet)
- Nothing above NIT. [NIT] the stored note lost its format characters --> FIXED (checked on a copy; an emoji note is kept as sent).
