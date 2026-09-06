# Plan: name the default/first world "Kosmos 1" (#1704 item 14.2)

## Context
Josh's 0.6.35 fresh-install feedback (#1704, item 14, filed by Renet Tilley from
Josh's fresh-install burst): "Call the default world 'Kosmos 1' (so users understand
it's the first one), alongside the existing 'Add a new Kosmos.'"

This is the worlds/header lane (Angel). The switch bug itself is #2238 (already
shipped); item 11 (top header) and item 14.1 (rename via cog) are separate, larger
asks handled elsewhere / deferred (see the card comment).

## What "done" looks like
- The default world (id `default`, `base:null`, legacy roots in place) is displayed
  as "Kosmos 1" in the switcher and promoted header name.
- A fresh install (no `worlds.json`) shows "Kosmos 1".
- An install that persisted the old name into `worlds.json` (a pre-change multi-world
  install) also shows "Kosmos 1" on read: the default world's name is a display
  constant, not user data.
- No id/base/path change; no data moved or renamed; named worlds untouched.

## Approach
- `engine/worlds.js`: `DEFAULT_NAME = 'Kosmos'` -> `'Kosmos 1'`. This flows to
  `defaultWorld()` (the synthesized default) and to `activeWorld()`'s fallback.
- `engine/worlds.js` `readRegistry`: after ensuring the default entry is present,
  force its `name` to `DEFAULT_NAME`, so a persisted old name is normalized on read.
  Justified because the default's name is a non-editable constant (id `default` is
  reserved; there is no rename path for the default world).
- No `web/index.html` change: the switcher already renders `w.name` from the API,
  so the new name flows through with no markup change (and no new browser render
  check is triggered).

## Tests
`engine.worlds-default-name-1704.test.js` (new), three arms each against its own
temp base:
1. fresh install (no registry) synthesizes the default as "Kosmos 1" (control: no
   registry file exists);
2. a registry persisted with the OLD name is normalized to "Kosmos 1" on read
   (control: the on-disk file really carries the old name) -- perturb-verified to
   fail without the normalization line;
3. a named world keeps its own name; the default persisted alongside a created world
   reads as "Kosmos 1".

Existing #1704 server.test.js worlds tests re-run green (they assert `id==='default'`,
not the name).

## Rejected / deferred
- Migrating persisted `worlds.json` files on write to rewrite the old name: heavier,
  and unnecessary because read-time normalization covers every install. Rejected.
- Item 14.1 (rename via cog) and item 11 (top header): out of scope for this slice;
  recorded on the card.

## Weakest premise
That the default world's name should always be forced to the constant. This holds
today because the default cannot be renamed. If a future feature makes the default
renamable, that feature must revisit the normalization in `readRegistry`.
