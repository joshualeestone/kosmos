# frozenarrow-1752: check-frozen-roots recognises arrow resolvers

## The card (kosmos#1752)

Two instruments with overlapping blind spots read as coverage: `check-frozen-roots.js` (a static
scan) and an export-walk test both missed `engine/tokendoor.js`, whose factory built a Map of
doors at require time and froze a secrets path -- so a test setting its sandbox seam late could
have overwritten a real API token. The card named three blind spots: (1) a `const` inside a
factory, (2) a `Map` export, (3) an arrow-function resolver.

## What is already closed on today's main (measured, not assumed)

- **The symptom.** `tokendoor.js` no longer exports an eager `DOORS` Map; it exports the
  `makeTokenDoor` factory, called on demand. No require-time freeze.
- **The pair problem.** `check-frozen-roots.js` was rewritten (post-#1443) to be multi-line and
  RESOLVER-aware: it flags a module-level const that reaches a source through a chain of resolver
  helpers. Measured by construction: it flags the exact tokendoor shape (a const eagerly building a
  Map from a factory that reaches a resolver) at the DECLARATION, export-shape-agnostic. So the
  static checker alone now catches the class, which is why the export-walk instrument could be
  retired -- the "two instruments, one blind spot each" problem is gone.

## The one live residual, and the fix

`functionNamesReaching` scanned only `function NAME(`, so an ARROW or function-expression resolver
held in a const (`const dir = () => path.join(root(), ...)`) was invisible, and a const that
eagerly called it froze a root UNDETECTED (blind spot #3). Proven live by construction; no real
engine module trips it today (`runningas.js`'s arrow `HOME` is used lazily), so it is a latent
instrument gap, not a live frozen module.

Fix: each lazy (function-shaped) const's body is now a resolver candidate in the transitive
closure. Precision is unchanged -- a candidate is marked a resolver only if its body reaches a
source or another resolver; a lazy const that reaches neither is still not flagged.

## Verification

- `tools/test-frozen-roots.sh`: 7 arms pass, including new **arm 4b** (a const frozen via an ARROW
  resolver is flagged). Mutation-verified: reverting the arrow addition reddens ONLY arm 4b; every
  other arm (including the two precision arms) passes.
- `node tools/check-frozen-roots.js engine` exits 0 on the real tree -- no new false positive.
- Full suite green.

## Scope note

The card's #1 (const-in-factory) and #2 (Map export) are covered by the checker catching the eager
CALL at the declaration; this change adds the missing #3 (arrow resolver). A fully
spelling-independent guard would be an AST check, which is a larger separate proposition the
checker's own comment already reasons about (it enforces the live literals and leaves the property
to the behavioural arms).
