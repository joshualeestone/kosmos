# wash-tokens-3206 -- collapse the status-wash rgba literals to CSS tokens (#3206)

## Problem
The working/needs-you status washes `rgba(47,125,90,.10)` (green) / `rgba(179,38,30,.09)` (red)
are hand-duplicated byte-identically across 4 surfaces in web/index.html. The repo's
"two derivations of one fact" convention class. #3206 (surfaced by a challenge-loop review of
agentlist-states-6720; coordinated with Mona, its owner, to land AFTER 6720 merged so all 4
surfaces exist and tokenize together).

## What finished looks like
One source of truth for each wash: `--wash-working` / `--wash-attn` defined once in :root, and
every surface references it. No byte-identical copy of the wash literal remains outside the token
definition. Rendering is unchanged (computed style resolves the token to the identical rgba).

## Change (web/index.html)
- Define once in the base :root (next to --k-surface): `--wash-working: rgba(47,125,90,.10);`
  `--wash-attn: rgba(179,38,30,.09);`.
- Reference `var(--wash-working)` / `var(--wash-attn)` in all 4 surfaces (working + attn each):
  - `.acard.working` / `.acard.attn` (grid card)
  - `.lrow.working` / `.lrow.attn` (list row base)
  - `html[data-layout="consolidated"] body.consolidated.fold-a .lrow.working` / `.attn`
    (folded rail -- KEEP its `border-radius: 0`, only the two rgba pairs tokenize)
  - `#pj-one-agents .pj-member.pjm-working` / `.pjm-attn` (project member)

## Scope (deliberate)
- ONLY the `.10`/`.09` background WASHES. NOT border-colors (.42/.55), the pulse animation
  (.07/.20/.14), the .acard.hot heat wash (.16), or the pj-member hover variants (.16/.15) --
  those are different values, not duplicates of this wash.
- Theme-independent: there is no dark override for these washes today (only borders/glows have
  dark variants), so ONE definition in the base :root serves both themes exactly as the literals
  did. If #3131/#3187 later wants the unfolded-rail wash to diverge, it defines its own token then;
  today all four are the same value, so collapsing is correct per the convention class.

## Why this is CI-safe (verified against the files, not assumed)
- Tokenization changes a literal into `var(--wash-*)`; standard CSS resolves a custom property
  to its defined value, so the COMPUTED background is byte-identical to the old literal. That is
  the primary basis, and it does not depend on a repo browser-check.
- Two of the four surfaces are additionally covered by a computed-style browser-check:
  `docs/browser-checks/render-agent-lines.js` reads `getComputedStyle(row).backgroundImage`
  (:123 and :141) and asserts the RIGHT wash per state -- green for working, red for needs-you
  (#3187) -- for the `.lrow` base and folded rail. Since it reads computed style, `var(--wash-*)`
  resolving to the same rgba is positively verified there.
- The other two surfaces (`.acard.working/.attn`, `#pj-one-agents .pj-member.pjm-working/.attn`)
  have NO computed-style browser-check for their wash: `render-member-modal.js:237` probes only
  the pjm-IDLE gray (#2920), not the working/attn wash. Those two rest on standard var()
  resolution plus the node source tests below (the #2711 pin + the new #3206 test), which assert
  the SOURCE references the token and the token is defined -- not that a browser renders it. This
  is a pre-existing computed-style gap for those two surfaces, low-risk, not introduced here.
- No node test greps web/index.html source for the raw wash literal (grep-confirmed), and the
  added :root comment carries no `<script>` token, so it cannot break an HTML-slice test.

## Test plan
- Node suite (validation_log_run_or_skip) green in the worktree. NOTE this does NOT run the
  browser-check GATE CHAIN; that is separate (below) and was the thing that actually needed handling.
- Browser-check gate chain (run via CI's `tools/run-tests.sh`, `test.yml`), both satisfied by
  commit trailers because this is a copy-only, render-identical token refactor that updates no
  docs/browser-checks assertion:
  - #1720 coarse gate: `Browser-check:` trailer (a web/ change with no assertion update needs a reason).
  - #2518 surface gate: TWO checks are surface-mapped to tokens my diff touches, each with its own
    named trailer:
    - `Browser-check-surface: render-member-modal.js <reason>` -- token `pj-one-agents` (my
      `.pj-member.pjm-working/.attn` edit); that check probes only the pjm-IDLE gray (#2920,
      rgba(120,120,128,.07)), which this refactor does not change.
    - `Browser-check-surface: render-dm-badges-2863.js <reason>` -- token `lrow` (my `.lrow.working/
      .attn` base + folded edits); that check asserts DM-badge GEOMETRY over the `.lav` corner, not
      the wash colour (its own header already records that the #3131/#3187 `.lrow` wash change does
      not move/clip the badge). A render-identical var() swap leaves that placement untouched.
    - No other check is surface-mapped to a token my diff hits (`acard`, `pj-member`, `pjm-*`,
      `consolidated`, `fold-a` are declared by no check; verified by grepping every
      docs/browser-checks Browser-check-surface annotation).
    NOTE the surface gate diffs against `origin/main`, a SHARED ref other worktrees advance, so its
    flagged set can shift as main moves; the two named trailers cover the deterministic token hits.
- Render correctness: `.lrow` base + folded washes are computed-style-checked by
  render-agent-lines.js (unchanged, still green because var() resolves to the same rgba); the
  `.acard`/`.pj-member` washes rest on standard var() resolution + the node source tests (see the
  CI-safe section above).
- Merge-as-green (Kosmos beta, no human reviewer).

Addresses #3206
