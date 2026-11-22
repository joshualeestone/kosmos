# quietstdin5-8905: the five other Mac stdin readers stop on a silent pipe (kosmos#8905)

## Problem

On the Mac CLI (`install/kosmos`), five verbs read a body with no words from stdin by a bare `$(cat)`, with no time
limit: `community post`, `community comment`, `community edit`, `community endorse`, and `feedback triage --cards -`.
An agent that runs one with no words and an open pipe nobody writes to waits for ever. #8899 (PR #8907, merged as
41703aae1d) added `_read_stdin_quiet` for `feedback write` and `feedback note`; the Windows CLI already reads all five
with a quiet limit.

## Decisions

- Each Mac verb takes its Windows twin's limit, measured in `tools/windows/kosmos-cli.js`: the four community verbs read
  with `STDIN_QUIET_LIMIT_MS` (3 s), triage `--cards -` with `CARDS_STDIN_QUIET_LIMIT_MS` (120 s). The card's "post
  --stdin" 120 s is the ROOM post (`kosmos post --stdin`), not `community post`.
- `_read_stdin_quiet [seconds]`: an optional limit from this file (`KOSMOS_STDIN_CARDS_QUIET_S=120`), never from the
  caller's environment (#8899 review 1). A malformed limit answers 7 rather than waiting.
- `_stdin_refused <code> <past tense> <noun> <remedy>` says codes 5, 6 and 7 one way, then exits 2. Each verb's remedy is
  its Windows twin's ("Save it in a file instead and give its path: kosmos community post --body-file <file>"; triage:
  "Pass the titles in a file instead: --cards <file>").
- The reader runs `kosmos_engine_node` (the bundle's node, else the system's), not `$NODE` alone: a source checkout has
  no bundled node, and the community verbs already use the system one (11 existing tests caught it). With no node at
  all it answers 7, never a bare `$(cat)` that would still hang. This also applies to #8899's feedback write and note;
  in the installed layout nothing changes for them.
- Whitespace that stops arriving answers 0 (the reader's 6 needs a non-space character), so the verb's own empty check
  refuses it, as on Windows.

## Rejected

- One 3 s limit for all five: triage's piped command can be slow to start, which is why Windows gives it 120 s.
- An environment variable to shorten the limit in tests: #8899 review 1 ruled out reading the limit from the caller.
  The 120 s case is tested on a copy of the CLI with that one constant set to 1, and a test pins the real constants to
  the Windows CLI's.

## Tests

`cli.community-quiet-stdin-8905.test.js` (real CLI, throwaway data folder, dead loopback):
- per verb: an open silent pipe refused within its limit; a body that stops without ending refused as maybe cut short;
  CONTROL a whole body never refused by the reader;
- triage on a 1 s copy (a line that forgot its own limit fails the timing at the 3 s default);
- the Mac limits equal the Windows constants; no bare `$(cat)` reader left;
- no node at all (no bundled node, bare PATH, stand-in bundled tmux): refused at once.

Controls run: against #8899's head without this change 12 of 17 fail (8 hang to the 20 s kill), the 5 whole-body
controls pass; a mutant where triage forgets its limit fails both triage refusals at about 3 s; a mutant with the old
no-node `$(cat)` fallback hangs to the kill.

## Weakest premise

That the test's stand-in environment (a dead loopback, a throwaway KOSMOS_HOME) reaches the same stdin read a real
agent's call does. The probe of each verb against the real CLI shows the read is the first thing that blocks.
