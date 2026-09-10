# kosmos#2563 — "Add my agents from an existing Kosmos" at create (web UI slice)

## Definition of done (what is TRUE when finished)

On the create-a-new-Kosmos flow (the `world-add-modal`), the user can optionally choose to
import agents from one or more of their existing Kosmoses at create time. The control:

- defaults to importing NOTHING (a brand-new Kosmos starts with 0 agents),
- lists the user's OTHER Kosmoses with agent counts, multi-select,
- passes the selection to the create call so the engine can copy those agents in.

The slice SHIPS SAFE before the engine exists: when the list endpoint is absent (404/500/empty),
the control hides itself, so the create flow is unchanged. Node tests cover the null AND positive
cases; a browser-check pins the served (graceful-empty) state; the full node suite + the browser-check
gate chain are green; a screenshot of the create modal with the control is attached to the PR.

## Decisions (mine, per Splinter + Josh's standing "decide it yourself" ruling)

- **COPY semantics**: the source Kosmos keeps its agents; the new Kosmos gets copies. Documented on
  the card; Josh can swap to move in-app. (COPY is the safer, expected reading of "add my agents from".)
- **Default = 0 agents** (brand-new Kosmos).
- This is an explicit opt-in selector, DISTINCT from the existing disk find-agents import
  (`/api/scan-import`, `#import-found`).

## Endpoint contract (engine is a SEPARATE lane — build against this, stubbed/graceful)

The engine half is routed to a board owner; the card carries the contract. This slice depends on:

1. `GET /api/worlds/list` -> `200 { worlds: [{ id, name, agentCount }] }` (the user's Kosmoses + counts).
   Does NOT exist yet. UI treats absent/404/500/empty as "no other Kosmoses" and HIDES the control.
2. `POST /api/worlds` accepts an added body field `importAgentsFrom: [worldId, ...]`. `createWorld`
   ignores unknown fields today, so sending it is a harmless no-op until the engine reads it.

So the UI wires up automatically when the engine lands; no coordination race either direction.

## Anchors (worktree HEAD 306d9515, web/index.html)

- `world-add-modal` markup: ~7959 (name field ~7964, actions row ~7967).
- `worldAddOpen()` ~17950, `worldAddClose()` ~17959, `worldAddSubmit()` ~17963 (create POST ~17972).
- Switcher list fetch `worldsFetch` ~17642.

## Checklist

- [ ] **1. Markup** — in `world-add-modal`, between the Name field and the actions row, add an
      "Add my agents from" control: a labelled container `#world-add-import` (hidden by default) with a
      list holder `#world-add-import-list` and an empty/hint line. Use existing `.field`/`.tk-*` classes.
- [ ] **2. JS render (self-contained)** — `worldImportRender(worlds, listEl, wrapEl)`: given an array,
      build a checkbox per world (`name — N agents`, accessible label, focusable), or hide `wrapEl` when
      the array is empty. MUST be self-contained (the node suite eval-extracts web/index.html functions;
      an extracted fn that calls an out-of-scope helper throws ReferenceError — memory
      `kosmos-extracted-painters-must-be-self-contained`). Build markup inline.
- [ ] **3. JS fetch** — `worldImportFetch()`: `GET /api/worlds/list`, return `worlds` array on 200, `[]`
      on any non-ok / parse error / network error (graceful — memory
      `a-threshold-gated-display-hides-its-null-case`: the empty case is a real state, pin it).
- [ ] **4. Wire open** — in `worldAddOpen()`, reset the control, then fetch + render (await, best-effort;
      a failed fetch just leaves the control hidden).
- [ ] **5. Wire submit** — in `worldAddSubmit()`, gather checked world ids; include
      `importAgentsFrom: ids` in the POST body ONLY when non-empty (keep the no-selection payload
      byte-identical to today so existing create tests are unaffected).
- [ ] **6. CSS** — minimal styling for `#world-add-import` reusing existing tokens; AA contrast.
- [ ] **7. Node test** — `web.world-import-2563.test.js` (runtime-DOM, no jsdom — memory
      `runtime-dom-test-pattern-no-jsdom`): (a) empty array -> wrap hidden; (b) populated -> one checkbox
      per world with name+count and an accessible label; (c) `worldAddSubmit` includes `importAgentsFrom`
      when boxes are checked and omits it when none. Declare any new module-scope global the extracted
      functions reference in each test's wrap (memory `a-new-global-breaks-eval-sliced-node-tests`).
- [ ] **8. Browser-check** — `docs/browser-checks/render-world-import-2563.js`: open the create modal,
      assert the import control exists and shows the graceful-empty state on the served board (endpoint
      absent). Pin the specific control + a negative assertion it is not confused with the disk-import
      panel (memory `a-render-check-that-asserts-existence-passes-the-wrong-asset`). Bump BOTH
      `EXPECTED_SITES` and `EXPECTED_CATCH_SITES` in `browser-checks-reason-grep.test.js` (memory
      `kosmos-new-browser-check-count-bumps`).
- [ ] **9. Gates** — `bash tools/run-tests.sh` (node) AND the browser-check shell gate slice, since local
      run-tests is node-only (memory `kosmos-web-change-browser-check-gate-chain`). Assert the expected
      test count, not just exit 0.
- [ ] **10. Screenshot** the create modal with the control (headed), attach to PR + Discord reply.
- [ ] **11. `/challenge-loop`** to convergence (bound the loop; sweep on web/index.html — memory
      `bound-the-review-loop-before-it-starts`), then PR: reviewer `joshualeestone` only, squash, merge on
      green. Non-closing `Addresses #2563` (engine slice still open). No em dashes anywhere.

## Weakest premise

That `createWorld` ignores unknown POST fields (so `importAgentsFrom` is a safe no-op today). Verified
in engine/worlds.js:234 (`createWorld(base, name)` reads only name), but re-confirm the POST handler at
server.js ~17972's server side does not reject an unknown body field before build.
