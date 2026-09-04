---
pre_challenge: true
method: challenge-loop
branch: richtext-render-2067
diff_hash: 0993c1dbf08dc2fe8cec12e7ab8b5682330753ca66f384005ece8b20c28c039b
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T06:39:44Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (a clean 6.0 baseline + 3 fresh blind review passes)
**Converged:** Yes — the third blind pass produced zero new actionable findings.
**Total findings:** 9 (1 BLOCKER, 4 WARNINGs, 4 NITs) + 10 STRENGTHs
**Fixed:** 7 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 — 6.0 baseline validation
Full node/shell suite + subdir-CLAUDE.md audit ran clean against the initial
commit (`1159c925`). No findings; baseline established.

#### Iteration 2 — blind review pass 1 (commit 2e219b86)
**New findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs
- [BLOCKER] web/index.html pjRichSpans — the bare-URL autolink built the `href`
  BEFORE the inline-code placeholder was restored, so `http://x/`+backtick-a-backtick
  restored the `<code>` tag INTO the href (malformed DOM, `rel`/`target`
  dropped). --> FIXED: rewrote pjRichSpans to extract code AND autolink URLs
  (by whitespace token, sentinel-excluded, trailing */~ peeled, `_` kept) to
  held placeholders BEFORE emphasis, then restore.
- [WARNING] web/index.html pjRichSpans — emphasis ran before autolink, so a URL
  containing `_` (e.g. `https://x.test/_a_`) was italicised mid-URL. --> FIXED by
  the same token-autolink rewrite.
- [WARNING] render-richtext-2067.js — the XSS control battery could not return
  the dangerous answer for the URL-adjacent-code vector. --> FIXED: added E1/E2/E3
  controls (now includes glued code/URL, underscore-URL, bold-ending-URL).
- [NIT] pjRichSpans — a stray U+FFFC sentinel in agent text was silently deleted.
  --> FIXED: strip incoming sentinel up front; out-of-range placeholder left literal.
- [NIT] comment/plan — "never leaks `**`" overstated (an unclosed inline marker
  stays literal). --> FIXED: reworded to "recognised/closed markers".

#### Iteration 3 — blind review pass 2 (commit 93ad47c4)
**New findings:** 1 WARNING, 1 NIT
- [WARNING] web/index.html pjRich fast-path — a markdown link to a NON-http
  target (`[the docs](docs/help.md)`, `mailto:`, an anchor) had no marker and no
  http, so it took the fast path and rendered raw `[text](url)` markup,
  contradicting the "renders as its TEXT only" contract. --> FIXED: added a
  `[text](url)` disqualifier to the fast-path guard so a link to any scheme
  routes to the slow path and is stripped to its text; added non-http link
  controls (relative + mailto) to the browser check.
- [NIT] content-dependent newline behaviour on `.pj-msg-text`. --> Documented
  inline at the fast-path guard (intended tradeoff, rule 2/3).

#### Iteration 4 — blind review pass 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (2 duplicates of deferred/documented items)
**Converged** — no new actionable findings.
- [WARNING] render-all-as-markdown styles literal prose punctuation (`5 * 5 * 5`).
  --> DEFERRED: this IS plan decision #6 (the documented weakest premise); the
  reviewer itself called it "a deliberate tradeoff, not a defect." Reversible;
  the store owner may later add a stored is-markdown flag.
- [NIT] a URL glued to emphasis/inline code is not linkified. --> DEFERRED: safe,
  no marker leak (E1/E3 controls assert it); rare glued form.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 2 | BLOCKER | web/index.html pjRichSpans | code placeholder restored into href | FIXED | 2e219b86 |
| 2 | 2 | WARNING | web/index.html pjRichSpans | underscore-URL italicised | FIXED | 2e219b86 |
| 3 | 2 | WARNING | render-richtext-2067.js | control missed URL-adjacent-code vector | FIXED | 2e219b86 |
| 4 | 2 | NIT | web/index.html pjRichSpans | stray sentinel deleted | FIXED | 2e219b86 |
| 5 | 2 | NIT | comment/plan | "never leaks **" overstated | FIXED | 2e219b86 |
| 6 | 3 | WARNING | web/index.html pjRich fast-path | non-http md link rendered raw | FIXED | 93ad47c4 |
| 7 | 3 | NIT | web/index.html pjRich fast-path | content-dependent newline | FIXED | 93ad47c4 |
| 8 | 4 | WARNING | web/index.html pjRichSpans | render-all-as-md styles prose punctuation | DEFERRED | By design (plan decision #6); reversible |
| 9 | 4 | NIT | web/index.html pjRichSpans | glued URL not linkified | DEFERRED | Safe, no leak; rare form |

### NITs (non-blocking)
- content-dependent newline on `.pj-msg-text` (iter 3) — documented, fixed-as-documented
- glued URL not linkified (iter 4) — deferred, safe

### Strengths (across passes)
- Injection-safe by construction: esc() before every downstream transform; URL
  `core` is a post-escape substring so no attribute breakout; `javascript:`
  unmatchable; every emitted tag has a hardcoded class (all three passes).
- The held-placeholder (U+FFFC) scheme cannot be spoofed: incoming sentinels
  stripped, held HTML never contains the sentinel, single-pass restore.
- Fast-path disqualifier is a complete superset of the slow-path transforms.
- Browser check drives the SHIPPED function (not a copy), with real
  dangerous-answer controls, an equality control, and a two-theme DOM+CSS paint.
