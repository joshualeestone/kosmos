# #6174: an agent mid-move is marked as still on its old account until it restarts

Owner: Angel. 2026-10-14 16:05 CDT. Follow-up named in the #6108 plan ("After a 'partial' move the server already lists
the agent under the new account, though it still runs on the old one until it restarts").

## Finished looks like
In Settings, AI Models, an agent moved to another account whose process is still running on its old account (the move
came back partial because its window could not be closed) is listed under the account it was moved to, with "(still on
its old account until it restarts)" after its name. Once it restarts onto the new account the marker goes, because its
running process then reads the new account. Every other agent reads as before.

## How
- `claudeAgentsByAccount(live)` (server.js) keeps grouping by each agent's launch file, and gains `moving(dir,
  isDefault)`: the agents on that row whose running Claude process reads a different account (runningas.everyone, the
  live reader the whoami path already trusts). `GET /api/accounts?agents=1` reads every process once, bounded at
  1.5 s (#1366), and sends `agentsHere.moving`.
- The page appends the marker to those names (web/index.html acctUsageHtml).

## Decided
- Option (b), mark on the new row, not (a), list under the running account: a partial move has three causes and only
  one (the window could not be closed) leaves the agent running on the old account. A stopped agent, or one whose
  relaunch failed, runs nowhere, and the new row is right for it. (a) would also need the live read and would move
  those back onto the old row.
- Never marked without a good reading of a Claude process: a failed read, Windows (no configDir there), another runner
  or an unknown default-ness leaves the agent unmarked.
- The live read only happens on ?agents=1 (Settings), so other callers of the accounts list do not pay for it.

## Not done
- The disconnect guard (enumerateAgentsOnAccount) still counts launch files only, so it does not see an agent still
  running on the account being removed until it restarts. Separate card if wanted.
- No marker on the old account's row ("X still runs here until it restarts"); the marker on the new row says it.

## Weakest premise
That runningas reads the process's CLAUDE_CONFIG_DIR correctly for every launch shape on a Mac (it falls back to
~/.claude when unset, which accounts.isDefaultDir must then call the default). Pinned in the unit test for the
default account; not measured on a real partial move.
