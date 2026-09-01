# #1652 fourth create-an-agent option: "import my existing agent" (UI half)

Branch: `import-ui-1652` (worktree `~/work/agent-workforce-import-ui-1652`, off origin/main).
Owner: Baron Draxum. Verifier: Shredder (has Playwright; his verification plan is written and waiting).
Server half is DONE and merged: `POST /api/agent-import` (#1778) + `agentfile.importAgent` (#1768).
This plan is the remaining UI half #1652 stays open for.

## What "done" is
A fourth option in the create-an-agent flow that lets a person bring in an agent they
already have as a `.agent.md` file: provide the file (paste text, or locate/upload it),
POST it to `/api/agent-import` to PARSE+VALIDATE, pre-fill the existing create form from
the returned `{name, displayName, provider, instructions}`, then the person confirms and
the EXISTING create submit runs (`POST /api/agents`) exactly like the other three options.

## The one hard invariant (do not violate)
IMPORT PARSES. THE EXISTING CREATE PATH CREATES. Do not add a second creation path.
- `POST /api/agent-import` writes NO state. It only parses/validates and echoes back
  fields derived from the caller's own input. (This is Shredder's question: import itself
  writes nothing; the CONFIRM step reuses the existing `POST /api/agents`, which writes
  the same state the other three options already write — dir, profile, launchd, tmux.)
- So the fourth option adds exactly ONE new network write path: none. The parse is a
  read-shaped endpoint; creation stays the single canonical `POST /api/agents`.
- Credentials do NOT travel in a `.agent.md` (Shredder's safe-default note). The file
  carries name/provider/instructions only; sign-in / key entry stays the existing
  per-provider flow after creation. The import form must never accept or forward a secret.

## Structure to mirror (fill exact ids from the map)
The create flow presents several options and one shared create form. The Explore map of
`web/index.html` gives the verbatim ids; mirror them rather than inventing markup.
- Options container: add a fourth option card/button beside "start fresh" / "adopt found".
- Shared form fields to pre-fill by id: name, displayName ("shown under their name"),
  instructions textarea, provider selector, model selector.
- Provider mapping: reuse whatever string the existing form uses (e.g. 'anthropic' /
  'openai'); map `importAgent`'s `provider` onto it. If provider is coming-soon/unknown,
  leave the selector at its default and let the person pick — never block the import.

## The flow, concretely
1. Fourth option selected -> show an import sub-panel: a textarea to paste the file, plus
   a "locate a file" affordance (`<input type=file>` read via FileReader.readAsText — no
   upload, parsed client-side into the textarea) so both "paste" and "locate" work.
2. On "Load"/"Continue": `fetch('/api/agent-import', {method:'POST', body: JSON.stringify({file: text})})`.
   - `{ok:false, because}` -> show `because` verbatim near the input, stay on the import
     panel, do not advance. (importAgent refuses hostile/non-Kosmos files whole.)
   - `{ok:true, name, displayName, provider, instructions}` -> set the shared form fields'
     `.value` from these (mirror the adopt/found pre-fill function), reveal the normal
     create form so the person can review/edit, then the EXISTING confirm submits.
3. Confirm -> existing `POST /api/agents` handler, unchanged.

## Client-side notes
- No client-side re-validation of the file beyond what the endpoint returns — the endpoint
  is the authority (importAgent). The UI only routes {ok/because} to the fields or the error.
- Keep the fetch same-origin, no new headers; crossSiteWrite already guards it.
- Do not send the operator's email or any credential in the body — only the file text.

## Test / verify plan
- I cannot render the UI. WRITING needs no Playwright; VERIFYING does. Shredder browser-
  verifies against his written plan. Hand him the branch (barondraxum -> shredder) when the
  markup + JS are in and the file loads/parses/pre-fills in a manual reasoning pass.
- A browser-check scenario belongs in `docs/browser-checks/` (siblings: render-create-form.js,
  render-create-made.js, render-found-board.js) so the option has a durable gate. Model it on
  render-create-form.js (two engines, paint-before-position assertions). Shredder may own this.
- Pre-PR: /challenge-loop (mandatory), then /create-pr, then self-merge on sight.

## Handoff state (if I hand #1652 off instead of finishing)
- Server half merged: #1768 (engine), #1778 (endpoint), #1764 guard (#1775).
- This branch `import-ui-1652` is clean, tip is a main commit, NO UI written yet.
- The Explore map of the create form (ids/functions) is the input the next builder needs;
  re-run it against web/index.html if lost.
- #1720 (browser-check gate) is SEPARATE and already pushed by Splinter to
  origin/browser-check-gate-1720 — DO NOT force-push over it; reconcile onto it when resumed.
