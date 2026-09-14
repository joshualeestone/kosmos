# Plan: codex-account-mover-2338 (kosmos#2338 piece 2)

Directive-driven build (Splinter MOBILIZE + Josh's "select an account to use the
subscription"). Written to satisfy the per-branch plan-file convention; the substance was
scoped from the card and the existing engine, and refined across a 6-iteration challenge loop.

## Goal

Let a Codex/ChatGPT agent be MOVED between the user's OpenAI (CODEX_HOME) accounts from the
same account picker that already moves a Claude agent between Claude accounts.

## What already existed (so this is UI + copy, not engine)

- `engine/create.js` `setAccount` already branches on the agent's runner and calls
  `setCodexAccount`, which rewrites the plist `CODEX_HOME` and restarts the agent.
- The route `POST /api/agent/:name/account` already calls `create.setAccount`, so the
  backend already performs a codex account swap.
- The gap was the UI: `paintAccountPicker` was Claude-only (the `movable` destination set
  filtered `memoryShared`, which OpenAI rows never carry), `paintProviderPicker` disabled
  `#d-account` for a codex agent, and the account route's success sentence was Claude-only.

## Approach

1. **web/index.html**: extract a pure `acctMoveWorld(a, accounts)` that decides, per
   provider, the movable account set and the current account. Codex destinations are the
   OpenAI rows gated exactly like the sibling create/switch picker
   (`offerable !== false` + `connection.state !== 'none'`); the current account is resolved
   from the full account list because the board resolves `a.account` against the Claude list
   only (a default codex agent arrives with `a.account` null). `paintAccountPicker` consumes
   it, `ours = movable.length > 0`, and the message chain is exhaustive across every codex
   account state. `paintProviderPicker` stops disabling `#d-account` for codex.
2. **server.js**: an honest codex success sentence - files/projects travel, per-CODEX_HOME
   Codex chat history stays with the old account (no cross-home symlink).
3. **Tests**: a pure-function unit suite for `acctMoveWorld` (with controls), and an extended
   `docs/browser-checks/render-codex-account-picker-2811.js` render check (surface
   `d-account-msg`) to satisfy the #1720 browser-check gate.

## What I did NOT do

- No engine change (`setCodexAccount` already existed and is correct).
- No session-history migration across CODEX_HOME (out of scope, and disclosed honestly in
  the success copy instead).

## Decisions / weakest premises (resolved in the loop)

- Mid-session account switch safety: same restart mechanism as the Claude mover (kill pane ->
  launchd relaunches on the new home), so it is as safe as the shipped Claude path.
- Destination gating: mirror the sibling picker's `offerable`/`connection.state` gates so a
  move onto an un-offerable or signed-out home is never offered (#1488/#1492).
