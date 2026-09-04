# Plan: openai-acct-name-2095 — store + serve the OpenAI account's human-chosen name

Card: joshualeestone/kosmos#2095 (routed to me by Splinter). Related: #2097/#2098 (Kitty's provider-awareness cluster) — this does NOT overlap them.

## The finding (traced in code)
The OpenAI connect form (`web/index.html` #acct-openai-label) posts the typed name as `body.label` to `POST /api/accounts/openai` -> `addWithKey({key, label, codexBin})`. `addWithKey` uses `label` ONLY to build the dir name `~/.codex-<cleanLabel(label)>`, and `cleanLabel` slugs it (`lowercase [a-z0-9-]`), so "My Work Account" becomes "my-work-account". `rowFor` returns that slug as `label` (and `null` for a default `~/.codex` account). Settings > AI Models and the create-agent account dropdown then show only `keyTail` ("API key ending NfYA"). So the exact name the person typed is never preserved or surfaced.

## Scope decision (mine, per Splinter: "build the store + display, DEFER the browser-verify; make the call, document")
- **BACKEND (build + unit-test now — fully verifiable by me):** persist the EXACT typed name and serve it as a new `name` field on the account record.
- **FRONTEND display (hand off):** the two render sites live in a 24k-line web/index.html whose account-render JS I cannot cleanly locate, and I cannot visually verify a change (browser constraint Splinter said to defer). A blind edit to that file risks breaking the render unseen. Per Splinter's "hand to a browser-capable session or note for Josh's morning test", I hand the display off with the exact served field named, rather than ship an unverifiable blind frontend edit. The backend makes the name AVAILABLE (the dead input is no longer dead at the data layer); rendering it is a small, well-scoped follow-up.

## Backend changes (engine/openaiaccounts.js)
1. `nameFile(dir)` = `<dir>/.kosmos-name`, with best-effort `readName(dir)` / `writeName(dir, name)`. A sidecar INSIDE the account dir (like auth.json): per-account, survives, rides the forget-rename. Separate from the slug `label` so the EXACT name is preserved, and works for a default account (which has no label). Fail-open everywhere: no file -> `null`, never an error.
2. `rowFor`: add `name: readName(dir)` to the record (null when never set).
3. `addWithKey`: on a successful login, `writeName(spot.dir, label)` (the RAW label, before cleanLabel slugged it) BEFORE `rowFor`, so the returned row carries the exact name. Best-effort — a failed name write never fails the add (the account still works, just unnamed).
4. Export `readName` (for the unit test) if the test needs it; otherwise test through addWithKey/rowFor/list.

## Tests (engine/openaiaccounts.*.test.js, matching existing patterns)
- addWithKey persists the EXACT name (spaces/caps preserved, NOT slugged) and rowFor/list return it as `name`.
- Fail-open: an account dir with no `.kosmos-name` returns `name: null` (the dangerous answer — a missing file must never throw or hide the account).
- The name is separate from the slug `label` (a name "My Work Account" -> label "my-work-account" but name "My Work Account").

## Verify
- Full node suite green (`yarn test`), incl. the existing openaiaccounts tests (my new `name` field must not break them).
- Runtime check: connect-shaped call persists + serves the exact name.

## Handoff for the frontend display slice (for a browser-capable session / Josh's morning test)
The served field is **`account.name`** (exact human-chosen name; may be null). Both surfaces should show it as the PRIMARY label with `keyTail` ("API key ending X") kept as a secondary detail, falling back to `label`/keyTail when `name` is null:
- Settings > AI Models: the OpenAI provider-card account row.
- Create-agent picker: the account dropdown option.
Verify visually that a named account shows its exact name (not the slug, not just the key last-4).

🛑 **The name is arbitrary user text, preserved verbatim (that is the point — no character sanitization beyond trim + a 120-code-point clamp).** So the follow-up MUST render it via `textContent` / a text node, or HTML-escape it — never `innerHTML` — or a name like `<img src=x onerror=…>` is a stored-XSS on the local board. The backend serving it raw is correct (it is JSON-safe); the escaping duty is entirely the render's.

## Weakest premise
That the frontend render only needs `account.name` served and a small display tweak, with no other plumbing. If the frontend account object is re-shaped somewhere between the API and the render (dropping unknown fields), the follow-up must carry `name` through that too. The backend serving it is correct regardless.
