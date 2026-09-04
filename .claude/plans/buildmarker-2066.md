# #2066 — Build marker: which version + channel a tester is on, in every screenshot

## Goal
A tester (or Josh) can answer "which version, and is this staging or prod" from a
problem screenshot, without being asked. Today nobody could, and it cost three chases
(cabal9 wrong-app, #1997 stale build, #2013 post-freeze hunt). This is the **display
half** of the safe-staging pair (#2036 is the verification half; #2004 cross-ref).
Design + copy: Mona Lisa (installkosmos.com/design/build-marker, `chaoskosmos-site
design/build-marker.html`). Josh's ordering stands — this is display/attribution, not
the paywall.

## What was already true (mapped before building)
- Version exists: `bakedVersion()` (baked meta `kosmos-version`, what the PAGE is) and
  the polled `data.version` (what the SERVER runs). `paintBuildLine()` renders the
  Settings `#build` line, preferring baked. Settings is NOT in a problem screenshot —
  that is the gap this closes.
- `.apphead` is the sticky chrome, but it goes `position:static` in the consolidated
  layout, so a **body-fixed** corner is the layout-robust home for "on every tab".
- `/api/status` (server.js) is the 5s poll; its JSON is assembled at one object literal.
- Port is per-account (`kosmosDefaultPort(uid)`); `window.location.port` gives it free.
  The board's own account NAME is not surfaced to the frontend today.
- `sourceChannel` did NOT exist anywhere. #2036's publish/promote half merged (PR #2077)
  but that is the publish side; the install-time recording the board reads is unbuilt.

## The channel constraint (#2036, Mona Lisa confirmed)
Do NOT bake the channel into the artifact. #2036's invariant is that the SAME bytes are
promoted to prod with no rebuild; a baked `channel=staging` stamp would need a rebuild
to flip, breaking "the tested bytes are the shipped bytes". The channel is instead
`sourceChannel`, recorded at install/update time from which pointer the build was
fetched, and read alongside the version. It is per-fetch (a property of how a machine
GOT the build, not of the build).

## What I built (display + read seam, prod-default)
1. **server.js** — `sourceChannelNow()` reads `<store.ROOT>/source-channel`, returns
   'staging' only on exact (trimmed, lowercased) `staging`, else **'prod'** (absence /
   unreadable / anything unexpected). Added `sourceChannel` to the `/api/status` body.
   `store.ROOT` already resolves `AGENT_WORKFORCE_DATA`, so tests seed the same path.
2. **web/index.html** —
   - `--stag` / `--stag-bg` tokens (light + both dark blocks: auto media + manual
     `[data-theme="dark"]`), Mona Lisa's values.
   - `#buildmark` (body-fixed corner) + `#buildmark.staging` CSS: prod = dim mono
     version string, no fill; staging = loud coloured badge (`--stag` ink on `--stag-bg`,
     `--stag` border, pill).
   - `paintBuildMark(version, sourceChannel)`: baked version wins (what am I looking at);
     staging only on exact 'staging'; prod otherwise; **hidden until a version exists**;
     hover `title` carries `version · channel · port` (+ stale note). Wired into the
     `/api/status` tick beside `paintBuildLine`, and a load-time `paintBuildMark(null,
     'prod')` so a built board shows its baked version from the first frame.
3. **Tests / checks**
   - `server.sourcechannel-2066.test.js` — real `/api/status` boot against a sandbox:
     default prod, 'staging' → staging, trims/lowercases, unexpected → prod.
   - `web.build-marker-2066.test.js` — executes `paintBuildMark` against a fake DOM:
     baked wins, absent/unknown channel folds to prod, no-version hides, port in title,
     channel-not-baked source guard.
   - `docs/browser-checks/render-build-marker-2066.js` — real render, COMPUTED-STYLE
     assertion (staging bg non-transparent AND ≠ prod, ink ≠ prod, border present),
     default→prod, no-version→hidden. **Reds on origin/main** (no fn, no element).
     Wired into `tools/browser-checks.sh` + README index.

## The join for Baron (staging-channel install work)
Baron's install/update writes `<store.ROOT>/source-channel` = `staging`|`prod` from the
pointer it fetched (`latest-staging.json` vs `latest.json`), at BOTH fresh-install
(setup.sh / `/setup`) AND update (engine/update.js) — Mona Lisa's coverage note: a
fresh staging tester must not read blank. `store.ROOT` = `~/Library/Application Support/
AgentWorkforce` (mac) / `$AGENT_WORKFORCE_DATA/AgentWorkforce`. Until that lands,
everything resolves to prod and no real board changes. HEADS-UP sent.

## Decisions / rejected / weakest premise
- **Rejected** baking channel into a meta tag (breaks #2036). **Rejected** waiting for
  Baron before starting (the display half is the bulk and is buildable now, prod-default).
- **Account name deferred**: port (`window.location.port`) is the cabal9 disambiguator
  (different port = different app) and is shown in the hover line; the friendly account
  NAME needs new server plumbing (the board's own identity isn't surfaced) — a follow-up,
  not a blocker. Port, not the name, is what catches the failure.
- **Weakest premise**: that `<store.ROOT>/source-channel` is a location Baron's install
  side can cleanly write. It is the natural server-read spot (sandbox-honoring, trivial);
  if his install side records the channel elsewhere, the join is a one-line server read,
  not a redesign. Confirming with Baron.
- **Screenshot-vs-hover tension** (noted for Mona Lisa/Josh): version + staging badge are
  always visible (in a screenshot); port/channel ride the hover, per her design. If the
  cabal9 which-app case needs port IN the screenshot too, that is a one-line change to
  make port visible — deferred to her call, reversible.
