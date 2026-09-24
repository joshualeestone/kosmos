# agentnav-3500 - Agent-view nav as icon+label rounded boxes

## Card
kosmos#3500 (Josh, 2026-09-23, wireframe screenshot): rework the agent view's nav from stacked
pill-buttons into ICON + LABEL rounded boxes. Direct Message is the LARGEST button (the default on
entering an agent). Four smaller buttons in a clean four-pack: Profile / Instructions / AI Settings /
Advanced. Move "Remove agent" INTO Advanced (that frees the clean four-pack). Rethink the active
state - not the full solid-gold fill; Josh wants OPTIONS on this. Build the mockup IN THE EXISTING
SOURCE so it can be copy-pasted; do not reproduce the wireframe literally. Design-iteration.

Splinter (relaying Josh's standing rule, 2026-09-24): ship Option A as the default, note B and C as
one-line swaps on the card. Built from text spec, pending screenshot reconcile.

## Done-condition
The agent nav (#d-nav) renders as an icon+label box layout: Direct Message large + default, a
four-pack below, Remove folded into Advanced, a rethought (not full-gold) active state - in both
themes, with the section-switch behaviour and its checks intact, and the Settings nav (#s-nav)
untouched.

## The change
- web/index.html markup (#d-nav): icon+label boxes. DM (data-go="talk") is the large `.dnav-dm`
  box labelled "Direct Message"; a `.dnav-pack` holds Profile / Instructions / AI Settings
  (data-go="model", relabelled) / Advanced (data-go="term"). The top-level Remove pill + separator
  are removed. Each button gets an inline-SVG icon. data-win-copy moved to the Advanced label span
  so the Windows "Live output" swap does not clobber the icon.
- JS: DETAIL_SECTION_GROUPS gains `term: ['term','remove']` and DETAIL_SECTION_PILL gains
  `remove: 'term'`, so Advanced reveals both the terminal and remove sections (the same fold
  mechanism model+memory / instr+skills use). detailNavNames sets the DM label to "Direct Message"
  and drops the two writes to the removed #d-nav-remove button (the remove SECTION still names the
  agent via its aria-label).
- CSS scoped to #d-nav (an id, beating the shared `.snav button` rules) so #s-nav is untouched,
  mirroring how #3505 scoped its pill work to #s-nav. The four-pack is a single column of smaller
  boxes, not a 2x2 grid: the ~200px nav column halves to ~95px cells in a 2x2, too narrow for
  "Instructions" / "AI Settings" on one line, which the #3045 no-overflow guard forbids.
- Active state (`#d-nav button.on`): Option A - a faint gold wash + a gold outline + a gold-deep
  icon, label in ink. Not the old full-solid-gold slab. Alternatives noted for Josh: B a gold
  left-accent bar only; C gold icon + underline, no fill.

## Verification
- render-agent-nav.js updated to the new structure (PILLS drops 'remove'; GROUP gains term:[term,
  remove]; asserts the DM box reads "Direct Message" and there is NO top-level Remove pill; the
  Advanced click reveals [term+remove]). Passes both themes.
- render-win32-board-copy.js 88/88 (the Advanced -> "Live output" swap works with data-win-copy on
  the label span). render-agentpage-fullwidth-2012.js passes. #3045 no-overflow guard passes.
- Headless screenshots (light + dark) reviewed: clean icon+label boxes, DM large with the Option-A
  active state, four-pack fitting; posted to the design channel for Josh's active-state pick.

## Rejected
- A 2x2 four-pack grid: overflows the ~200px nav column (#3045 guard) unless the column widens,
  which the wireframe would have to call for; noted for Josh.
- Physically moving #d-sec-remove markup into #d-sec-term: unnecessary and riskier than folding via
  DETAIL_SECTION_PILL (the existing, tested mechanism).

## Weakest premise
That "AI Settings" is the intended relabel of "Model and Memory" (the four-pack names it AI Settings;
the model section holds model + memory). If Josh wants a different label, it is a one-word swap.
