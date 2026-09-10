# Plan: board_token resolves node + store module across both layouts (kosmos#2644)

## Problem

The fleet-wide agent self-report path has been frozen since 2026-09-03 (the live tail of #2509). Measured root cause:

- The report hook (`install/kosmos-report-hook.sh`, `resolve_kosmos`) prefers the source-checkout CLI `~/work/agent-workforce/install/kosmos` on a box whose installed bundle is stale.
- That CLI's `board_token()` runs `"$NODE" -e '...store.ROOT...' "$KOSMOS_HOME/app/engine/store"`, where `$NODE = $KOSMOS_HOME/runtime/bin/node`. The source layout has neither: no `runtime/`, and the store module is `engine/store`, not `app/engine/store`.
- So the node call load-fails, `board_token` returns 1, no `x-kosmos-board-token` header is sent, and since #1976 made a board token required, the board refuses every report. The report POST itself is curl-based and reaches the board; only the token resolution fails. The fail-safe swallows the refusal, so it is silent and the board falls back to pane-scraping.
- The board.token is fine (presenting it directly records a report, HTTP 200). The store is shared across the same-OS-user accounts, so one token serves the whole fleet; the only break is the CLI not presenting it. Not migration-caused, not fixed by two boards.

## Change

`board_token()` resolves node and the store module across BOTH layouts, installed tried FIRST so its behaviour is unchanged:

- node: `$NODE` if executable, else `command -v node`.
- store module: `$KOSMOS_HOME/app/engine/store` if `.js` present, else `$KOSMOS_HOME/engine/store`.

Also updates the stale calling-convention comment that claimed a `$NODE`-absent layout returns 1 (now handled).

## Verification

- Measured before: source-checkout CLI `board_token` load-fails; `kosmos report` refused.
- Measured after: fixed CLI resolves ROOT=`~/Library/Application Support/Kosmos`, reads board.token, presents it, and a full `kosmos report` records on the live board ("Recorded. The board reads it from here." / a landed selfreport line).
- Installed layout unchanged by construction (its path tried first).

## Scope / non-goals

- Surgical fix to the report token path only. The broader source-vs-installed layout mismatch across the rest of the CLI (`APP`, other `$NODE` uses) is out of scope; the report POST is curl-based and unaffected.
- The durable installed-bundle path is #2511; the silence detector that would have caught this is #2522.

Refs: #2644, #2509, #1976, #2514, #2511, #2439, #2522, #253.
