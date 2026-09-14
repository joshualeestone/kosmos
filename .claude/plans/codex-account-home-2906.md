# Plan: #2906 Codex Memory reads wrong account home

## Problem

On a Kosmos board that runs Codex agents across more than one OpenAI account, the
Memory panel showed "Not yet read" for a live agent that was actually recording a
transcript. The status reader resolved every agent's Codex session under the board
process's own `CODEX_HOME`, not under the account the target agent was launched
with. A multi-account agent records its rollout under its own account home (the
launch job's `CODEX_HOME`, surfaced as `job.configDir`), so reading the board's
home returned `{found: false}` for a live agent on another account.

This is the same account-home defect behind #2907 (OpenAI subscription stays gray)
and #2801 (accounts show not-signed-in); both share the "reader uses the board's
account, not the agent's" root cause.

## Fix

Read the TARGET agent's own Codex account home, never the board's.

- `engine/codexsession.js`: `rollouts`, `forWorkdir`, and `read` take an OPTIONAL
  `home` argument. When a caller passes one, sessions are read from THAT account's
  home; when a caller omits it, the process-default home is used exactly as before,
  so every existing direct caller is unchanged.
- `engine/status.js` `readCodexSession(agentName)`: resolve the target agent's own
  launch job (`create.readJob`) and read its home
  (`job.configDir || create.defaultAgentCodexHome()`).

## Fail-closed

Never fall back to the board's account. If the launch job is missing, malformed, or
is not a `codex` runner, return `{found: false}`. A null `configDir` is a
default-account Codex agent, which resolves through `defaultAgentCodexHome()` (never
the board's `CODEX_HOME`). This means a status read cannot leak one account's
sessions to another, even when metadata collides.

## Tests

`engine/status.codex-account-home-2906.test.js` (9 regression tests):

1. an explicit account home reads only that home, never the board process account
2. two Codex agents on separate homes each get their own usage in one snapshot
3. a null-configDir agent resolves through `defaultAgentCodexHome()`, not board CODEX_HOME
4. a missing or malformed launch job FAILS CLOSED and never reads the board account
5. backward compatibility: `codexsession.read` with no home keeps the process-default home
6. no cross-account bleed: same workdir metadata in two non-board homes reads only the agent account
7. a matched rollout with no token count is "not yet measured", then gains usage after a turn
8. a non-codex runner FAILS CLOSED and never reads a codex rollout under any home
9. if `workerDir` throws, the reader FAILS CLOSED (the `!dir` arm, forced via a stub with a positive control)

Plus additive coverage in the existing `2257` and `2413` suites for the new
optional-`home` signatures.

## Scope kept out

The subscription/green path (#2907) is verified separately once this merges; it may
need only a link to this fix or a small follow-up if the subscription reader has its
own account-home read. #2913 (ChatGPT-sub sign-in name field) is unrelated.
