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

## Why this is CI-safe (measured)
- The wash browser-checks read the COMPUTED style, not the CSS source literal:
  render-member-modal.js:198 reads `getComputedStyle(probe).backgroundImage` (the .pj-member
  surface); render-projects.js / render-fields.js read computed backgroundImage/backgroundColor.
  `var(--wash-*)` resolves to the identical `rgba(47, 125, 90, 0.1)`, so every comparison passes
  unchanged.
- No node test or browser-check greps web/index.html source for the wash literal (grep-confirmed).
- The added :root comment carries no `<script>` token, so it cannot break an HTML-slice test.

## Test plan
- Full pre-PR validation (validation_log_run_or_skip) green in the worktree.
- CI `test` job (runs the browser-checks server-side) is the authoritative render confirmation:
  the .acard / .lrow / folded-rail / .pj-member washes still compute to the same green/red.
- Merge-as-green (Kosmos beta, no human reviewer).

Addresses #3206
