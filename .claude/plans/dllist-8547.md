# dllist-8547: `kosmos agent delete-leftovers --list` (kosmos#8547)

Finished means: on Mac, Linux and Windows, `kosmos agent delete-leftovers --list` reads the same plans a delete reads
(GET /api/removed, GET .../leftover for each) and prints what it would delete, what each one loses, what it would leave
for the board and what it is not offered, then exits 0 without asking anything and without sending any DELETE. It needs
no terminal. `--list` with `--yes` is refused before the board is asked anything.

Why: Homer ran delete-leftovers on 0.8.06 on the Windows box (Splinter, 11-16 11:12). `--yes` deleted nothing because
all 195 removed agents still have folders, and he stopped before the full delete, which retires community accounts for
good and includes agents named after people. That decision is Josh's; today the only way to see what it would do is to
start a delete and cancel at the question. --list makes it readable without risk.

## Steps
1. [x] tools/windows/kosmos-cli.js agentDeleteLeftovers: --list, refused with --yes, no terminal needed; the list branch
   sits after the plans are read and before the question, so nothing past it runs.
2. [x] install/kosmos: the same, same words (Trash for Recycle Bin).
3. [x] Help and usage lines on both.
4. [x] Tests (cli.agent-delete-leftovers-8547.test.js): --list on Windows and Mac sends no DELETE, asks nothing, shows the
   plan, exits 0, with a --yes control on the same stub; --list --yes refused with nothing sent; an empty plan lists
   nothing. Mutation: making --list behave like --yes fails both list arms on "a list sent a DELETE". 23 pass; the 248
   test files that read either CLI: 4785 tests, 0 fail.

## Review bound
Three blind rounds, then ship; leftovers to a card.

## Weakest premise
A plan read for the list can differ from the plan at delete time (a folder appears or goes). That is already handled
where it matters: the delete sends each plan's `confirm`, and the engine refuses if the plan changed.
