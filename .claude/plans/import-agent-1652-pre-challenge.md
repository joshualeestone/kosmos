---
pre_challenge: true
method: challenge-loop
branch: import-agent-1652
diff_hash: 55a075a8d23bb86e1acb8ea543feaf89e230c782c459c781d961c2d38b0b4b64
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T17:50:41Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 produced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 WARNINGs + ~11 NITs across all iterations
**Fixed:** all 8 WARNINGs + most NITs | **Deferred (with reasoning):** 3 NITs | **Asked:** 0

`importAgent(text, deps)` in `engine/agentfile.js` is the import direction of the
portable agent file (#1652): it parses a `.agent.md` into validated create-material
`{ok, name, displayName, provider, body}` or refuses whole, and does NOT create the
agent (the fourth create-an-agent option hands the material to the one canonical
`createAgent` path, so import reuses create's correctness -- a fresh id above all --
rather than becoming a second, thinner creation path). Validation: full suite
`bash tools/run-tests.sh` 3563/3563 (on the rebased base). The canonical validation-log
helper misdetects this repo's stack (pnpm/typecheck) so run-tests.sh is the real runner.

Seven blind, independent passes drove a security-sensitive outside-input parser from
"works" to "refuses every hostile file whole." The core (refuse-whole, the per-install
identity anchor cannot enter, path-safety, parse-not-create) was confirmed solid every
pass; the WARNINGs narrowed from a real security gap to a real correctness bug to
hardening.

### Per-Iteration Breakdown

- **Iter 1** WARNING: name validated only by safeValue (weaker than create.nameUsable);
  `../../etc/passwd` accepted --> FIXED by injecting the canonical create.nameUsable and
  refusing a path-unsafe name whole. NIT (untested marker/block arms) --> FIXED.
- **Iter 2** WARNING: name-validation promise vs enforcement (docblock overclaimed) -->
  tightened the shared safeValue to reject control/bidi and made the docblock honest.
  NIT: enforcement could drift from IMPORT_CONTRACT --> anti-drift test on .required.
- **Iter 3** WARNING: the returned displayName (the human-visible, spoofable field) was
  raw --> run it through safeValue, refuse a bidi-spoofed name. WARNING: safeValue missed
  the LRM/RLM marks + FEFF --> widened. NIT: anti-drift extended to .marker/.bodyMustName.
- **Iter 4** WARNING: "ALL bidi" claim omitted U+061C + U+2028/2029 --> added them
  (completing the Bidi_Control set), accurate comment. NIT: displayName unbounded -->
  MAX_DISPLAY=64.
- **Iter 5** WARNING: non-bidi zero-width chars in the preview displayName --> definitive
  documented scope: refuse the no-legit-use invisibles (U+00AD/200B/2060), DELIBERATELY
  keep the joiners U+200C/D (legitimate in scripts/emoji), explicitly NOT a homoglyph
  defence (the machine name's [a-z0-9_-] allowlist is the identity boundary). NITs: BOM
  literals --> ﻿ escapes; name reason made precise.
- **Iter 6** WARNING: field()'s `\s*` matched newlines, so an empty `key:` line adopted the
  NEXT line as its value (name:\nsmuggled -> name:'smuggled') --> `\s*` to `[ \t]*`. NIT:
  no size ceiling --> a coarse 512KB cap (above the 256KB downstream body limit) before
  any parse work.
- **Iter 7** CONVERGED: 0 BLOCKER/WARNING/CONVENTION; 5 STRENGTHs confirming refuse-whole,
  the identity-anchor containment, the field() fix, the displayName defence aimed at the
  right (bold) arm, and the documented Unicode scope as defensible and code-consistent.

### Deferred NITs (with reasoning)
- Iter 1: a timing oracle on report/reply routes -- N/A here (that was the Phase 2 loop).
- Iter 7: a `provider` value carrying a control/bidi char is dropped to null rather than
  refusing the file whole -- INTENTIONAL and reviewer-confirmed "arguably correct":
  provider is an explicit non-identity hint the create flow re-chooses, not a shown
  identity, so dropping a bad hint is the right behaviour.
- Iter 7: error strings use the curly apostrophe U+2019 -- within convention (not an em
  dash; consistent with the existing exportAgent messages in the same file).

### Strengths (across iterations, most-cited)
- Refuse-whole is complete: every path returns `{ok:false, because}` or a fully-populated
  `{ok:true}`; no half-apply, no throw on hostile/non-string/huge input.
- The per-install identity anchor cannot enter: the result is built field-by-field
  (name/displayName/provider/body only), so an `id:`/`dir:` in a hostile file is never
  read; asserted as an absence with a populated-material control.
- Name-safety layered without duplication: path-safety via the injected canonical
  create.nameUsable, cleanliness via safeValue, full policy deferred to create.nameProblem
  when the material flows through createAgent -- the docblock forbids treating ok:true as
  a fully-validated name.
- Tests are control-paired throughout; the round trip drives the REAL exportAgent; the
  anti-drift test pins .required/.marker/.bodyMustName to enforcement.

Note: local `main` is behind `origin/main` (branch base is origin/main after a rebase),
so the diff-hash covers already-merged commits. Benign: the proof and the pre-challenge-gate
hook both compute against local `main`, so they agree, and GitHub diffs the PR cleanly
against `origin/main` (only the three import-agent-1652 files). The shared main checkout was
not fast-forwarded (it holds another agent's uncommitted work).
