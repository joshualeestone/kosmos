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

#### Iteration 1
- [WARNING] engine/agentfile.js -- name validated only by safeValue, weaker than create.nameUsable; `../../etc/passwd` accepted --> FIXED (inject canonical create.nameUsable, refuse path-unsafe whole)
- [NIT] engine/agentfile.import.test.js -- untested marker/block arms --> FIXED

#### Iteration 2
- [WARNING] engine/agentfile.js -- name-validation promise vs enforcement (docblock overclaimed) --> FIXED (tightened shared safeValue to reject control/bidi, honest docblock)
- [NIT] engine/agentfile.js -- enforcement could drift from IMPORT_CONTRACT --> FIXED (anti-drift test on .required)

#### Iteration 3
- [WARNING] engine/agentfile.js -- the returned displayName (human-visible, spoofable) was raw --> FIXED (run through safeValue, refuse a bidi-spoofed name)
- [WARNING] engine/agentfile.js -- safeValue missed the LRM/RLM marks + FEFF --> FIXED (widened)
- [NIT] engine/agentfile.import.test.js -- anti-drift extended to .marker/.bodyMustName --> FIXED

#### Iteration 4
- [WARNING] engine/agentfile.js -- "ALL bidi" claim omitted U+061C + U+2028/2029 --> FIXED (added, completing the Bidi_Control set, accurate comment)
- [NIT] engine/agentfile.js -- displayName unbounded --> FIXED (MAX_DISPLAY=64)

#### Iteration 5
- [WARNING] engine/agentfile.js -- non-bidi zero-width chars in the preview displayName --> FIXED (documented scope: refuse no-legit-use invisibles U+00AD/200B/2060, DELIBERATELY keep joiners U+200C/D, explicitly not a homoglyph defence)
- [NIT] engine/agentfile.js -- BOM literals --> FIXED (﻿ escapes); name reason made precise

#### Iteration 6
- [WARNING] engine/agentfile.js -- field()'s `\s*` matched newlines, so an empty `key:` line adopted the NEXT line as its value --> FIXED (`\s*` to `[ \t]*`)
- [NIT] engine/agentfile.js -- no size ceiling --> FIXED (coarse 512KB cap before any parse work)

#### Iteration 7
- **Converged** -- 0 BLOCKER/WARNING/CONVENTION.
- [STRENGTH] refuse-whole complete, identity-anchor containment, the field() fix, the displayName defence aimed at the right (bold) arm, and the documented Unicode scope defensible and code-consistent.
- [NIT] engine/agentfile.js -- a provider with a control/bidi char is dropped to null not refused whole --> DEFERRED (intentional: provider is a re-chosen hint, not a shown identity)
- [NIT] engine/agentfile.js -- error strings use the curly apostrophe U+2019 --> DEFERRED (within convention; matches existing exportAgent messages)

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | agentfile.js | name path-safety not enforced | FIXED |
| 2 | 2 | WARNING | agentfile.js | name-validation promise overclaimed | FIXED |
| 3 | 3 | WARNING | agentfile.js | displayName returned raw (bidi spoof) | FIXED |
| 4 | 3 | WARNING | agentfile.js | safeValue missed bidi marks + FEFF | FIXED |
| 5 | 4 | WARNING | agentfile.js | "ALL bidi" claim missed U+061C/2028/2029 | FIXED |
| 6 | 5 | WARNING | agentfile.js | zero-width chars in preview displayName | FIXED |
| 7 | 6 | WARNING | agentfile.js | field() `\s*` adopted next line as value | FIXED |
| 8 | 7 | NIT | agentfile.js | provider dropped to null on bad char | DEFERRED |
| 9 | 7 | NIT | agentfile.js | curly apostrophe in error strings | DEFERRED |

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
