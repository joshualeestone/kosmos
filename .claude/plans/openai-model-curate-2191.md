# Plan: Curate the OpenAI model list (kosmos#2191)

## Problem
The OpenAI model picker shows a huge list. Josh flagged it during the 0.6.30
test. The chat-family allow/deny filter already drops non-chat models, so the
bloat is that /v1/models returns every DATED SNAPSHOT of each model (gpt-4o +
gpt-4o-2024-05-13 + gpt-4o-2024-08-06 + ...) and each survives as its own row.

## Goal
Show one row per model, not every snapshot, without losing a model and without
ever offering an id the account cannot run.

## Approach (decided; recommendation posted on the card)
Collapse dated snapshots, do NOT use a blind top-N (that would cut a model the
account has, or keep three snapshots of one).

1. `chatModelsFromList` groups ids by a "snapshot base" (the id with a trailing
   ISO-date `-YYYY-MM-DD` removed, and ONLY that -- `-mini`/`-nano`/`-preview`
   and `-latest` are part of the base, so distinct models never merge). One
   representative per base: the base ALIAS id when the account lists it (it points
   at the current snapshot), else the newest dated snapshot. The `arg` is always a
   real returned id -- an alias is used only when present, never synthesized
   (#1026: a bad id is an agent that fails to start).

## The coupling this must not break
`accountModels()` output was ALSO the server-side validation allowlist for a
chosen model. Collapsing the menu must NOT narrow what an account may RUN:

2. `chatRunnableIds` returns the full un-collapsed chat-id set; `accountModels`
   returns it as `runnableKeys`. A shared pure helper `runnableAllowlist(got)`
   returns the validation allowlist, or null when the account is not checkable so
   validation fails OPEN (#1916). The create and change-model routes validate
   against it -- so a stored snapshot id still validates while the menu stays
   short.
3. The change-model picker injects a row for the agent's current model if the
   collapsed menu omits it, so a snapshot-pinned agent shows its actual model and
   can re-select it -- non-destructively (selects the exact id, never silently
   swaps the pin for its collapsed alias).
4. The GET display route strips `runnableKeys` (a server-side validation input,
   not display data) so the collapse's payload-shrink intent is not undone.

## Scope
engine/openaiaccounts.js (collapse + runnableKeys + runnableAllowlist), server.js
(two validation routes + GET route strip), web/index.html (picker current-model
injection). Tests + a browser-check arm.

## Verification
- Engine unit tests: openaiSnapshotBase (trailing-date-only), collapse
  (alias-preferred, newest-when-no-alias asserting a real returned id, mini not
  merged, over-collapse-to-zero control), chatRunnableIds, runnableAllowlist
  (ok -> full set, older-shape fallback, not-ok -> null fail-open).
- Server: the GET route omits runnableKeys (asserted).
- Picker: web.detail-openai-model-2140.test.js S2 arm (snapshot pinned -> injected
  + selected, alias not selected, auto not selected) + the browser check
  render-detail-openai-model-2140.js SNAPSHOT-PINNED arm.

## Out of scope / not done
- Legacy mid-id date forms (gpt-4-1106-preview) are left intact (small, old
  residual) -- only trailing ISO dates are collapsed, to avoid mangling.
- The injected current row shows the raw snapshot id (not prettified) -- a snapshot
  id is arguably clearer raw, and a client-side prettify would risk drift from the
  engine's prettyOpenaiLabel.

## Decisions
- Collapse, not top-N: removes duplicates, not choices.
- Display vs runnable split: curation narrows the DISPLAY, never the runnable set.
- Never synthesize an alias id (#1026).
