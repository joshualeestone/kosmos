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

## Iteration 2 (a blind pass found a false negative in the class I claimed to close)

The first version reused `declarations()` (which terminates at the first `;`) to capture a
const-held resolver's body. For a BLOCK-body arrow the source call is after the first `;` (the
first statement), so it was truncated and the eager const calling it was missed -- while the
identical `function` form was caught. Arm 4b only tested the single-expression form that dodges the
hole. Fixed: `resolverBodyFrom` captures a const-held resolver body to the closing brace for a
block body (the `^}` heuristic function declarations already use) and to `;` for a single-expression
arrow. Also replaced the fixed 2-round transitive closure with a FIXPOINT (`while (changed)`), which
the same pass showed was needed for a reverse-declared chain 3+ deep.

## Verification

- `tools/test-frozen-roots.sh`: 9 arms pass -- the two precision arms (lazy arrow, unrelated const),
  the liveness arms, **arm 4b** (single-expression arrow resolver), **arm 4c** (MULTI-LINE
  block-body arrow -- the false negative), **arm 4d** (reverse-declared 3-deep chain), and
  termination. Mutation-verified: disabling block capture reddens ONLY arm 4c; reverting the
  fixpoint to 2 rounds reddens ONLY arm 4d; every other arm passes.
- `node tools/check-frozen-roots.js engine` exits 0 on the real tree -- no new false positive; 0.04s.
- Full suite green.

## Known pre-existing limit (out of scope, named)

`isLazy` does not recognise `async () =>`, so `const T = async () => os.homedir()` is flagged as a
frozen root (a false positive) -- unchanged by this diff, and an async resolver returns a promise,
not a frozen value, so it is not the frozen-root shape. Left as a separate follow-up.

## Scope note

The card's #1 (const-in-factory) and #2 (Map export) are covered by the checker catching the eager
CALL at the declaration; this change adds the missing #3 (arrow resolver). A fully
spelling-independent guard would be an AST check, which is a larger separate proposition the
checker's own comment already reasons about (it enforces the live literals and leaves the property
to the behavioural arms).
