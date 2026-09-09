# Plan: #2338 - ChatGPT subscription sign-in (Codex-managed) + subscription-vs-API-key connect picker

Owner: Ice Cream Kitty (Splinter assigned Phases 0-4, 2026-09-09; Pete off it on bc-surface-gate). Build in this worktree, PR for Kosmos review, challenge-loop first. Grounded in Pete's code map on kosmos#2338 + my measurements below.

## Goal
Let a user connect their OpenAI via a ChatGPT SUBSCRIPTION (Codex-managed, NO API key), alongside the existing API-key path, and put a subscription-vs-key CHOICE on the connect UI (both providers, per Josh 8.01.55). Run half is already built + auth-mode-agnostic (interactive codex in a tmux pane reads whatever CODEX_HOME/auth.json holds); the MVP is a LOGIN flow + a connect-UI branch, NOT the app-server JSON-RPC.

## Phase 0 (DONE - probe, read-only)
- codex login surface CONFIRMED: `codex login` (default = browser ChatGPT), `--device-auth` (headless/code fallback), `--with-api-key`, `--with-access-token`.
- Installed codex-cli 0.149.1 (/opt/homebrew/bin/codex, PATH; no bundled-codex ref -> Kosmos launches PATH codex). Behind the >=0.153.4 stable Pete wants pinned - VERSION-PIN is a DEPLOY/packaging action (which codex the packaged 0.6.50 resolves), flagged for release, not a code blocker.
- CODEX_HOME per-account isolation is wired (engine/openaiaccounts.js defaultDir/authFile + agent-supervisor.sh env + create.js plist). Run half auth-mode-agnostic.
- identityFromData (openaiaccounts.js:130-146) ALREADY reads auth_mode:chatgpt (decodes tokens.id_token email). So "detect a subscription account" already works; only "create one in-app" + "check it live" are missing.

## Codex login MARKERS (measured 2026-09-09, isolated CODEX_HOME, non-completing)
Device-auth (`codex login --device-auth`) prints:
- "sign in with ChatGPT using device code authorization"
- "Open this link in your browser and sign in to your account" then a URL: `https://auth.openai.com/codex/device`
- "Enter this one-time code (expires in 15 minutes)" then a code like `3PI3-2LM3M`
Browser mode (`codex login`, default) markers NOT yet captured (running it opens a real browser on the dev box). Capture during Phase 1 impl in a throwaway pane (Pete's Measurement-B style), OR use device-auth as the primary Kosmos path (a code+URL to DISPLAY needs no browser dependency on the user's Mac, and it is the same shape as Claude's "paste code" step). DECISION: primary = device-auth (display URL + code, user opens URL + enters code), mirroring Claude's paste-code UX; browser mode is a later nicety.

## Phase 1 - the chatgpt-mode LOGIN flow (core new backend)
Mirror engine/connect.js (Claude OAuth): launchSignin (:1870) -> pane-watch classifyPane (:855, browser-open/awaiting-code/login-done) -> finishConnected (:2551), routes /api/connect/start + /api/connect/code.
Build the codex parallel:
- Launch `codex login --device-auth` in a tmux pane with `CODEX_HOME=<fresh isolated dir>` (env prefix + the bare multi-arg form connect.js proved for tmux 3.6a; set CODEX_HOME explicitly, do NOT inherit the user's ~/.codex).
- A codex classifyPane: match the markers above -> emit {url, code} for the UI to display (device-code step), and a login-done signal.
- Detect completion by RE-READING the auth.json in that CODEX_HOME: gate "connected" on auth_mode:chatgpt + a decodable identity (identityFromData already does this) - NOT on any status string (codex login status lies, openaiaccounts.js:18), NOT on /v1/models (needs a key).
- Add `addWithChatgptLive({label, codexBin})` alongside addWithKey(:450), SEPARATE connection type (authMode distinguishes; never silent subscription->key fallback).
- Routes: an OpenAI-connect start/code pair (mirror /api/connect); wire into the accounts router.

## Phase 2 - connect-UI picker (the seam I decided on the card)
ONE picker component, both rows: OpenAI ("Sign in with ChatGPT" [Phase 1] vs "Use an API key" [existing]) and Claude ("Sign in with Claude" [existing OAuth] vs "Use an API key" [#2420]). First click on a provider shows the two-way choice (Josh 8.01.55). web/index.html #fr-openai panels (:8065+) + the Claude row. Coordinate exact markup as I build it.

## Phase 3 - model handling (subscription accounts)
MVP: accept default-model fallback (already: openaiaccounts.js:973-977 "cannot list models yet"; web/index.html:26940 "let OpenAI choose"). A real subscription model source (codex model/list, app-server) is a FUTURE card.

## Phase 4 - live-state + lifecycle
A live connected/reauth-required check for chatgpt accounts (checkLive returns UNKNOWN today, openaiaccounts.js:632). Reuse forget/remove.

## Phase 5 (PARKED - Josh input, record-not-block)
Release gate = a REAL ChatGPT Pro subscription proving an end-to-end coding turn on the packaged codex (Pete's demo fixture). Phases 0-4 build + unit-test WITHOUT one. "Announce support" waits on the live turn.

## Weakest premise (mine)
That the interactive codex TUI runs a chatgpt-auth CODEX_HOME identically to an api-key one, no api-key assumption in the run path (agent-supervisor.sh:369 sets no OPENAI_API_KEY, which supports it). Prove in Phase 1 / the Phase-5 gate; if the interactive run assumes a key, fall back to `codex exec` for subscription runs (bigger).

## Build order this session
1. Read finishConnected (:2551) + addWithKey (:450) + the /api/connect routes fully.
2. Implement addWithChatgptLive + the codex-login-device-auth pane flow + classifier (unit-tested, no real login).
3. Then Phase 2 UI, Phase 4 lifecycle. Challenge-loop, PR.
