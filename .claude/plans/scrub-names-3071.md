# #3071 - codebase legal scrub (agent-workforce): external-person names + banned brands

Legal scrub. Josh, 2026-09-14: remove all book.io / stuff.io references AND the four
external-person names (Ben, Nacho, Sheila, Morpheus, incl. their test-fixture forms) from the
codebase, keep the brand-guard functional, and add a name-guard so they cannot come back. Tests
stay green (this is why it is code work, not a card edit).

## Inventory (agent-workforce, measured on origin/main)

- **Brands**: only `no-brand-refs-1881.test.js` (the guard, allowlisted) + `.claude/plans/*.md`.
  No product-surface brand leak. Non-plan, non-guard brand hits = 0.
- **Ben**: 45 files by word-boundary match. Classes:
  1. provenance comments naming a real external tester -> "an external tester" / "the tester".
  2. fixtures + a variable name: `ben-the-cat`, `ben.json` / `{"name":"ben"}`, `ben@example.com`,
     the `const BEN = ...auth line...` variable, the "the Ben case" / "THE BEN CASE" scenario label.
  3. name-corpus token `'ben'` in `server.test.js`.
- **Nacho**: fixture agent `lilnacho` / `Lilnacho` / `Lil Nacho` / `lil-nacho`, including the test
  FILENAME `engine/discover.lilnacho-1493.test.js` and `workers/lilnacho` fixture paths.
- **Morpheus**: 2 `.claude/plans/*.md` prose hits. **Sheila**: 0 in agent-workforce.

## Replacement scheme (consistent, non-real-person)

- Ben the person (prose/comments) -> "an external tester" / "the tester".
- Ben fixtures -> `roo` (`roo-the-cat`, `roo.json` / `{"name":"roo"}`, corpus token `roo`).
- Ben fixture email -> `tester@example.com`.
- "the Ben case" scenario label -> "the expired-401 case".
- `const BEN` variable -> `EXPIRED_PANE`.
- Nacho fixture -> `pixel`: `lilnacho`->`lilpixel`, `Lilnacho`->`Lilpixel`, `Lil Nacho`->`Lil Pixel`,
  `lil-nacho`->`lil-pixel`, path `workers/lilnacho`->`workers/lilpixel`, file renamed via `git mv`.
  (Preserves the casing/space/hyphen properties the discovery tests assert on.)
- Brands in plan prose -> "the two banned brands" / "the previous org repo"; repo refs ->
  `joshualeestone/claude-setup`; example emails -> `agent@example.com`.

## Brand-guard (`no-brand-refs-1881.test.js`)

KEEP functional. De-literalize its positive-control corpus + comments so the literal brand
spellings no longer textually exist in source (build the samples from concatenated parts; runtime
values + assertions unchanged). The PATTERNS regexes stay (blocking mechanism). Leave the
`.claude/plans/` exemption + ALLOWLIST self-exemption as-is.

## Name-guard (NEW: `no-name-refs-3071.test.js`)

Mirrors the brand-guard. PATTERNS: word-boundary `\bben\b` (substring is unsafe - bench/beneath/
benign), substring `/nacho/i` (catches lilnacho/lil-nacho), `/sheila/i`, `/morpheus/i`. Negative
controls prove `\bben\b` does NOT fire on bench/beneath/benefit/benign/benchmark. Same tree scan,
same `.claude/plans/` exemption, same self-allowlist. **Skips binary files** (NUL-byte detect) so
screenshot PNG bytes coincidentally containing "ben" do not red the guard. Corpus de-literalized.

## Sequencing (commits) - AS BUILT

1. Names scrub in code (engine/web/server/docs/tests) + fixture renames + `git mv` test filename,
   AND de-literalize the brand-guard in the same commit (both are the core code scrub).
2. Add the name-guard test (`no-name-refs-3071.test.js`).

That is the whole change. There is no plans-scrub commit - see the scope decision below.

**Scope decision (plans): DO NOT scrub `.claude/plans/*.md`.** (This reverses the tentative
"scrub plans too" call an earlier session left in this file.) Reasons, strongest first:
1. The card says "from code, keep guards." Plans are internal dev-process proof docs, not code,
   and "keep guards" is a direct instruction to preserve the #1881 mechanism - which by
   Josh-approved design EXEMPTS `.claude/plans/`.
2. #1881's own finding: a one-time strip regrows; the durable deliverable is the guard, not the
   strip. Plans are exempt from BOTH guards, so scrubbing them is an unenforced one-time strip
   that regrows - exactly the failure mode #1881 exists to avoid.
3. Scrubbing ~138 hits across ~40 historical proof docs by hand risks corrupting the record of
   WHY past decisions were made, for zero durable (guarded) benefit.
4. The scrub + both guards already cover every product/code/config/doc surface - the coherent,
   enforced boundary.

**Weakest premise**: that Josh's "don't exist inside of this codebase" meant product/code/config
surfaces, not literally every tracked byte including internal proof docs he never sees. **What
would change my mind**: Josh saying plans count - then it is one revertable follow-up commit
(genericize brand/name prose in `.claude/plans/`), guards still exempting the dir.

Validate via targeted node tests + isolation (the box self-contends on the full suite). Full
challenge-loop before PR. `Addresses #3071` (non-closing). Companion to Splinter's 79-card scrub.
