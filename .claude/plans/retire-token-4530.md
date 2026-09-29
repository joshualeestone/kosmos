# retire-token-4530: a Mac run's sender token stops being a credential when the run is over (#4530)

Owner: Scorpion (from Kano, Liu Kang m3311). Reviewer: Kano (the delta from 7e5f56500).

## Problem

On a Mac, the supervisor mints a sender token on every launch and nothing retired it. Tokens coexist by
design (engine/sendertoken.js) and are capped at MAX_LIVE (32) per agent, so every past launch stayed a
valid credential until 32 newer launches pushed it out. Measured on one fleet Mac on 2026-09-29: 106 live
tokens across 8 agents, up to 23 per agent, the oldest from 09-10. Windows already retires its run's token
(engine/win32create.js, sendertoken.retire).

## Ruling (Liu Kang, on the card)

The Mac supervisor retires its run's token when that run exits, and on relaunch. Do not revoke(), which
would kill the live run's token. Done means a test, red on main, that after a relaunch the agent has exactly
one live token and the previous one does not resolve.

## Design

1. `sendertoken.mint(name, { launcher })` records what launched the run. The Mac supervisor passes
   `supervisor:<session>`; `/api/agent-token` (remote agents) passes `remote`.
2. After its run's session exists and is claimed (launch path), the supervisor calls
   `retireLauncher(name, "supervisor:<session>", thisInstance, { untagged })`: it drops that launcher's
   other runs, and with `untagged` also every token with no launcher (all runs minted before #4530).
3. `untagged` is set only when the `-discord` twin (which shares the token file) has no session, by exact
   name; a tmux that cannot answer counts as "may live". It is never set on the adopt path: after an
   update a supervisor adopts a live pre-#4530 run, whose own token is untagged.
4. When a run's session is gone (two has-session=1 answers 2s apart), its supervisor retires that run's
   token. The run's instance is stamped on its session so an adopting supervisor can retire it too.
5. A launch that never started retires its own token on EXIT.

Rejected: a blanket sweep on every start (it would cut off an adopted live run and a live twin); revoke()
(kills the live run).

## Tests

- supervisor.retire-token-4530.test.js: the real supervisor against the real token store and a tmux
  stand-in. RELAUNCH (Liu's criterion), EXIT, ADOPT, OTHERS (remote), FLAKE/STOPPED for claude and
  antigravity, ONES, LOSER, TWIN (adopt, launch race), UNTAGGED (launch retires, twin keeps, adopt keeps).
- engine/sendertoken.test.js: retireLauncher, with and without untagged; the remote route is tagged.

## Weakest part

The twin check relies on the -discord naming convention; a third session sharing a token file some other
way would not be seen. And KOSMOS_WORLD is not tested end to end.
