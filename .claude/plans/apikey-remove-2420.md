# apikey-remove-2420: forget/remove an api-key Claude account (#2420 follow-up)

## Context
Prior slice (PR #2432, on main) made api-key Claude accounts first-class in
`list()`/`listLive()` (marker: the mode-0600 key file `.kosmos-claude-apikey`,
no `oauthAccount`). This slice makes them removable. It MUST land before Angel's
UI slice, or a listed api-key account shows a Disconnect/Remove button returning
a false "not a Claude account on this computer".

## The defect
`accounts.forgetAccount` and `accounts.removeAccount` both gate on
`if (!identityOf(clean))`. `identityOf` reads `oauthAccount` only, so it is null
for an api-key account, and both functions REFUSE one with a misleading "that is
not a Claude account on this computer". They must accept an api-key account (a
`.claude-*` dir carrying the key file) while STILL refusing a name-shaped dir
that is neither oauth nor api-key (`.claude-workers`).

## Design decisions
1. **Relax the guard, not remove it.** Replace `!identityOf(clean)` in BOTH
   functions with "neither an oauth identity NOR a stored api key". Reuse the
   module-local `apiKeyStored(dir)` helper (already used by `list()`), so the
   marker definition stays single-sourced. `.claude-workers` (neither) still
   refused.
2. **forget erases the raw key + unwires the pointer** (#2420 item 4: "forget:
   remove the key file + the apiKeyHelper entry, mirror forgetCodexFolder's
   clean-removal discipline"). Do it AFTER the successful rename, operating on the
   moved-aside TARGET dir, and best-effort (try/catch), so:
   - a rename FAILURE destroys nothing (identical to the oauth failure path); and
   - the forgotten-aside dir retains no live raw key and no dangling apiKeyHelper.
   Erase only when the account had a key (`hadKey`), so an oauth forget is
   untouched. `forgetKey`/`unwireApiKeyHelper` both already exist and are
   unit-tested in `engine/claudeaccounts.js`.
   - NOTE (correction to my own night handoff): the handoff cited #1414 as the
     basis for erase-on-forget. #1414 is about codex TRUST entries, unrelated.
     The real basis is #2420 item 4. Conclusion unchanged; citation corrected.
3. **remove needs no separate erase.** `rmSync` deletes the whole dir, key file
   included. Only the guard is relaxed.
4. **No server.js route change.** Erasure lives in the engine (the one place that
   does the rename), keeping the DELETE route thin and every caller correct. The
   route's `usedBy` enumeration already works for an api-key dir (a normal
   `.claude-<label>` dir; agents point CLAUDE_CONFIG_DIR at it like any account).
   Verified by reading the route.

## Weakest premise
That erase-on-forget is wanted rather than symmetric-with-oauth (leave the
credential, reversible). Resolved by the card: #2420 item 4 states forget removes
the key file + apiKeyHelper entry explicitly. If Josh later wants api-key forget
to be reversible like oauth, drop the post-rename erase block; the guard
relaxation stands either way.

## Tests (engine/accounts.forget-1659.test.js, engine/accounts.remove-2264.test.js)
- forget an api-key account -> renamed aside (in list-then-gone), the raw key file
  ERASED from the moved dir, and the apiKeyHelper entry unwired from its
  settings.json. Transcripts/dir survive aside.
- remove an api-key account -> dir deleted entirely.
- `.claude-workers`-shape (NEITHER oauth NOR key) STILL refused by both (existing
  tests already cover this; keep them green as the over-relax guard).
- Perturbation: revert each guard relaxation and the erase, confirm the new arms
  red.

## Validation
- Fast unit: `node --test engine/accounts.test.js engine/accounts.forget-1659.test.js engine/accounts.remove-2264.test.js` (no box).
- Full suite via the box at merge time.
