# #2419 - Found-agents IMPORT rows: name + "Add to Kosmos" only, one-click add-in-place, no jump

## What finished looks like
On the find-agents screen (`#fr-fleet`) and the create-form import panel (`#import-found`), each
discovered agent FILE renders as **name + one "Add to Kosmos" button** (no role, no path, no
instructions preview). Clicking Add parses the file and creates the agent behind the scenes, then
the button becomes a green "Added to Kosmos" check **in place** - the list stays put and the flow
does NOT navigate to the create-agent page. Node tests + the new browser-check pass; challenge-loop
converges; PR merges on green.

## Scope
The loose-file IMPORT rows only: `foundImportRowsHtml` / `.fr-importrow` / `.fr-importgo`. NOT the
disk-scan candidate rows (`scanRowsHtml` / `.fr-scanrow`, preview load-bearing - #2389, Renet). NOT
the discovery-offer styling (#2025).

## Changes (web/index.html)
1. **`foundImportRowsHtml`** (~28629): strip each row to `data-import-file` + `.fr-importname` (name,
   with the existing nameless stand-in) + a `.fr-importgo` button reading **Add to Kosmos** + an
   empty `.fr-importsaid` status line. Drop the role, the path, and the preview `<textarea>`.
   aria-label keeps label-in-name order: "Add to Kosmos, <name>".
2. **`.fr-importgo` click handler** (~28761): replace the two-surface branch (frImportFromScan on
   `#fr-fleet`, importFoundFile elsewhere - both JUMP) with one `addImportedInPlace(file, btn, row)`
   call on both surfaces.
3. **New `addImportedInPlace`**: disable + "Adding…"; POST `/api/agent-import-file` to parse; on
   `!ok`/parse-fail show the reason on `.fr-importsaid` and re-enable; if the parse yields no
   derivable name, say so and re-enable (can't one-click a nameless agent); else POST `/api/agents`
   with `{ name, role:'own', label:displayName?, instructions?, provider? (only if enabled) }` -
   **tellKosmos intentionally omitted** (server sets `wanted = tellKosmos !== false` and
   `ping.agentCreated` gates on the global setting, so omit = defer to the person's global ping;
   this AVOIDS the stale-checkbox OFF bug the old form path had). On success: button → "Added to
   Kosmos", add `.added` (green check), mark row `.done`, stay. On failure: re-enable + reason.
4. **Remove `frImportFromScan`** (only caller was the old handler branch).
5. **CSS**: `.fr-importrow` → two-column grid mirroring `.fr-foundrow` (name left, button right);
   `.fr-importsaid` status line spanning both columns, `:empty{display:none}`; `.fr-importrow.done`
   border; gold fill `#firstrun/#import-found .fr-importrow .btn.uprime`; green check
   `.fr-importgo.added` (color `--ok`, `::before content:'\2713'`). Remove `.fr-importrole`/
   `.fr-importpath` (no longer rendered).

## Tests / browser-checks
- **`web.import-found-1652.test.js`**: rewrite the row assertions (name + `data-import-file` +
  `fr-importgo` + "Add to Kosmos"; NO role/preview/path shown; still escaped). Rewrite the flow
  assertions: `addImportedInPlace` parses via `/api/agent-import-file` then creates via
  `/api/agents`, and the click handler no longer jumps to create / no `frImportFromScan`.
- **NEW `docs/browser-checks/render-import-add-inplace-2419.js`**: drive the shipped page, seed a
  found import row, stub `fetch` for the two endpoints, click Add, assert: button reads "Added to
  Kosmos" + carries the check glyph, row stays present, create tab did NOT open. Headless (DOM state
  only). Satisfies the #1720 browser-check gate.
- Re-run `import-agent-flow.js` (paste path unchanged), `render-firstrun-import-1652.js`,
  `render-firstrun-scan-on-grant-1652.js` (asserts `.fr-importrow`/`.fr-importgo` still present).

## Weakest premise
Omitting `tellKosmos` relies on `ping.agentCreated` gating on the global setting internally - verified
in server.js (`wanted = body.tellKosmos !== false`, engine refuses on `!pref.on`). If that ever
changed, a behind-the-scenes add would ping even when the person's global ping is off. Mona owns the
final button copy ("Add to Kosmos"/"Added to Kosmos").
