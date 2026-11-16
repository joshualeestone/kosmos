# astra-8593: Codex 0.169.0 on Mac and Linux, gpt-6 in the OpenAI model list

Card: kosmos#8593 (a user's ask through Josh, 11-16 16:01 CST; Splinter's routing to Renet Tilley).

## Problem
A user's ChatGPT account has gpt-6-astra; the bundled Codex 0.149.1 is refused for it on the ChatGPT sign-in path
("requires a newer version of Codex"), and gpt-6 classed as an unrecognised model in the OpenAI list.

## Decisions
- Codex 0.169.0 for Mac (arm64) and Linux (x64, arm64), each pinned to the npm registry's sha512. Windows stays on
  0.149.1 (its hook forms are measured per version on Windows); the steps for Homer are on the card.
- gpt-6 is a recognised family: gpt-6-astra sorts first, has no "compatibility not verified" mark, and is the default
  for a new OpenAI agent when the account lists it. Josh can override (the default pick in chatModelsFromList).
- The bump reaches existing installs: a managed Mac/Linux runner OLDER than the pin is stale; a board sweep replaces it
  in the background (3 tries per pin per run, brake AGENT_WORKFORCE_RUNNER_UPGRADE_OFF=1). The previous tree is kept
  until the new one proves itself and put back on any failure after the swap starts. An upgrade does not count as
  installing() until its swap starts, so routes and status keep working during the download.
- Codex 0.169.0's interactive screen runs through a background daemon that outlives the pane; the supervisor adds
  --no-daemon for Codex >= 0.169 (read with a timed --version, else from the managed tree on disk).
- The hook gate is a per-platform list of measured versions; the org-chart reader accepts 0.169.0's four new catalog
  fields (two forced, one dropped) and its capture test asserts a non-empty subset of tools that cannot act.

## Measured (11-16, this Mac)
- 0.169.0 names gpt-6-astra (0.149.1 does not). Live API-key turns: 0.169.0 + gpt-6-astra and + gpt-5.5 answered;
  0.149.1 + gpt-6-astra also answered (the refusal is on the ChatGPT path only).
- Token refresh writes through the auth.json symlink on both versions (fake token endpoint).
- Real-Codex hook test passes on 0.169.0 with its broken-hash control.
- Org-chart capture test passes on 0.169.0 on a real 10-model catalog; a mutation re-enabling the shell reds it.
- Enter gap unchanged (0 s no, 0.5 s and 1 s yes) with --no-daemon; no daemon left behind.

## Follow-ups filed
#8596 (a supervisor test red on main on a Mac), #8597 (the model-upgrade menu at launch), #8598 (a running older Codex
using the new tree's side files after a swap).

## Weakest premise
That the user's ChatGPT path accepts gpt-6-astra on 0.169.0: only an API-key turn was possible here (the ChatGPT
sign-in on this computer is lapsed). The user's own sign-in after release is the final proof.
