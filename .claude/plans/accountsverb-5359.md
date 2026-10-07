# #5359 part 2: `kosmos accounts`, so agents stop hand-rolling the accounts read

**Branch:** `accountsverb-5359` · **Card:** kosmos#5359 (field ideas from a Windows install's crash report)

## The ask

Agents read the board's provider accounts by hand: the instructions said "there is no one-word verb that prints
accounts, so it is a direct read of the route", with the port, the board token and argv hazards to get right.

## The change

- `kosmos accounts` in both CLIs (install/kosmos `cmd_accounts`, tools/windows/kosmos-cli.js `verbAccounts`), the
  same lines on both: one line per account, "<provider>: <email> (<auth mode>): <state>", the state in words
  (signed in; not signed in, and why; being checked now; could not be checked just now, and why). No accounts, a
  refusal, an unreachable board and an unreadable answer each get their own sentence.
- It reads `GET /api/accounts` with the board token, as `kosmos connections` reads its route. The route checks
  every account live, so the verb's usage and the instructions say: when you need it, never in a loop. `--help`
  prints the usage and never runs the check.
- The agent instructions (engine/connections.js) now say to run `kosmos accounts` instead of reading the route.

## Decided, not missed

- Part 1 of the card (a board note "recovered after a crash at HH:MM") is a separate change and a separate PR: it
  needs the board to tell an unclean stop from a clean one, which is its own design.
- The live check per account is the route's existing behaviour; the verb adds no cache (the route's own comment
  forbids one: a window turns "cannot tell" into a confident answer).

## Verification

- cli.accounts-5359.test.js (Mac CLI against a stub board): each state's line, no accounts, a refusal, an unreadable
  answer, the board token on the request, and `--help` never asking the route.
- tools.windows-kosmos-cli-accounts-5359.test.js (Windows CLI through main()): the same lines, the board token and
  never the agent token, and the four failure sentences.
- Mutations, each red: the Mac verb without the board token; the Windows verb sending the agent token.
- Every cli.* and tools.windows-kosmos-cli* test, the repo guards (engine.reachable, windows-tests-1777, the #3628
  exit-code rule) and the instruction tests: all green (counts in the proof).
