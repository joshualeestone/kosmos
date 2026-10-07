# #5359 part 2: `kosmos accounts`, so agents stop hand-rolling the accounts read

**Branch:** `accountsverb-5359` · **Card:** kosmos#5359 (field ideas from a Windows install's crash report)

## The ask

Agents read the board's provider accounts by hand: the instructions said "there is no one-word verb that prints
accounts, so it is a direct read of the route", with the port, the board token and argv hazards to get right.

## The change

- `kosmos accounts` in both CLIs (install/kosmos `cmd_accounts`, tools/windows/kosmos-cli.js `accountLine` and
  `verbAccounts`), the same lines on both: one line per account, "<provider>: <email> (<auth mode>): <state>".
- The state is read as the board's Settings > AI Models row reads it, the badge first (blind review 1, a BLOCKER:
  a Claude credential on disk is state "connected" even when its last request was refused, #874, so reading state
  alone printed "signed in" for a refused login). In words: a sign-in that has run out says when its agents stop
  (#5168); working is signed in; signed_in_unverified is signed in by Kosmos's record, not yet confirmed; rejected
  and signed_out are not signed in; unchecked could not be checked; a ChatGPT sign-in whose free check gave no
  answer reads as signed in by its own record, as the board shows it (review 3); with no badge, the state as before.
- Board text (an email, a reason) is printed with control characters replaced, so it never prints as an extra line.
- Each account is named as the board names its row (acctPrimaryName), short of its folder path: the chosen name, the
  email, "API key ending <tail>" for a keyed provider, the label; the Google subscription and Meta sign-ins, which
  carry none of those, are named as such (review 4: two keyed accounts of one provider printed as identical lines).
- The line gives the state the board shows, not every detail: a login's "good until" date is left to Settings >
  AI Models (decided, review 4's NIT).
- One class rule on both CLIs: a fault on the board (5xx, JSON or not) is told as a fault, never a refusal; a 4xx is
  a refusal only when the board says why, and otherwise "could not read, try again". No accounts, an unreachable
  board and an unreadable answer each get their own sentence.
- Each CLI keeps its own stream convention for a failure sentence, as its `connections` does: the Mac's `say` writes
  to stdout, the Windows `ctx.err` to stderr (review 2 asked for one stream; changing either CLI's convention for
  one verb would make that verb the odd one out on its own platform).
- No token hint after a refusal (#5333 adds one to verbs that send an agent token): this verb sends the board token
  only, so the hint could never be about it.
- It reads `GET /api/accounts` with the board token, as `kosmos connections` reads its route. The route checks
  most accounts live (some rows are Kosmos's own record), so the usage and the instructions say: when you need
  it, never in a loop. `--help` prints the usage and never runs the check.
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
- Mutations, each red: the Mac verb without the board token; the Windows verb sending the agent token; the
  rejected-badge arm removed in both CLIs.
- Every cli.* and tools.windows-kosmos-cli* test, the repo guards (engine.reachable, windows-tests-1777, the #3628
  exit-code rule) and the instruction tests: all green (counts in the proof).
