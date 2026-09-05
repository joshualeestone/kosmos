# #2140: sort the OpenAI picker most-powerful-first by GPT tier (item 9)

## The ask (Josh, 0.6.35 feedback item 9)

Sort the OpenAI model menu most-powerful-first: GPT version descending
(5.6 > 5.5 > 5.4 > ...) then tier within a version (Terra > Soul > Luna,
Pro > plain > Nano > Mini), then the GPT-4s.

## The bug

`OPENAI_CHAT_FAMILIES` is a fixed prefix list topping out at `gpt-5`. A tier an
account returns that is newer than gpt-5 (e.g. `gpt-5.6-terra`) matched no prefix,
so `openaiModelClass` returned `unknown` and `chatModelsFromList` ranked it LAST
(`OPENAI_UNKNOWN_RANK = 999`) with a "compatibility not verified" marker -- the
exact opposite of Josh's "most powerful at the top". (Splinter confirmed Josh's
running 0.6.35 picker already fetches these tier names live from his account.)

## The change (surgical, in engine/openaiaccounts.js)

New `openaiHighTierRank(low)`: parse `gpt-<major>[.<minor>]`; if the version is
ABOVE the top known family (`OPENAI_TOP_KNOWN_VERSION = 5`), return a negative
rank `-(version*100 + tierScore)` so it sorts above every fixed family, higher
version and higher tier first. `openaiTierScore` maps Josh's within-version order
(terra 9 > soul 8 > luna 7 > pro 6 > plain 5 > nano 4 > mini 3).

`openaiModelClass` checks this BEFORE the fixed-prefix lookup: a newer-than-gpt-5
tier is `{kind:'chat', fam:{rank,why}}` -- recognised (no unverified marker),
ranked at the top. Everything else is unchanged:

- versions at or below gpt-5 fall through to the existing fixed ranks (no
  regression -- a control test pins gpt-5 / gpt-4.1 / gpt-4o / gpt-4 order);
- a non-chat variant of a newer tier (gpt-5.6-audio) is still dropped (#1026);
- a non-gpt unrecognised id (o5, mystery-x) is still offered unverified-last
  (the #2217 behaviour, unchanged).

Forward-compatible: a future `gpt-6` sorts above `gpt-5.6` with no code change.

## Tests

`engine/openaiaccounts.test.js`: Josh's version-then-tier order from a shuffled
input; newer tier is recognised (not unverified); the fixed families below gpt-5
keep their order (regression control); gpt-6 forward-compat; a non-chat newer
variant dropped and a non-gpt unknown still unverified-last. The three prior
#2217 "unknown" tests that used `gpt-6` as their stand-in were updated to a
non-gpt id, since gpt-6 is now correctly recognised by version.

## Weakest premise (stated because it is the only thing that could make this a no-op)

The parse assumes the id is gpt-prefixed with a numeric version (`gpt-5.6-terra`,
OpenAI's shape). The raw `/v1/models` ids for these tiers are a live per-account
fetch and are NOT in this repo (verified: not in code, not in the dist artifact,
and the screenshots show display labels, not ids), so this is built and tested
against that shape. If a tier ships under a non-gpt id, the parse misses it and
the model falls back to unknown-last (safe, not a wrong order) until the regex
learns the shape -- a one-line change. Flagged to Splinter with the one datum
that would confirm it fires: a real example `/v1/models` id string.

Also: the display label is the id prettified (`gpt-5.6-terra` -> `GPT-5.6-terra`),
consistent with every other OpenAI row (`GPT-4o`); a nicer "5.6 Terra" label
would be a separate label-mapping task and does not affect the order Josh asked
for.
