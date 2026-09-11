# Plan: Discord-style hover emoji reactions (#2806 ask 3)

Branch: room-react-hover-2806, off main AFTER #2806 asks 1+2 merged (61dc959b).
Addresses kosmos#2806 (ask 3; asks 1+2 shipped in PR #2824).

## The ask (Josh, exact words)

"I wanted to remove the plus buttons for the emojis. When you mouse over, you get
some indication that you're on top of their message and it would automatically
populate with a little thing to then expand the emojis, just like Discord. I think
we should have some default ones that you could quickly hit, like a thumbs up and
heart and fire, and then the grey smiley face that would let you then pick from our
list of emojis."

So: (1) remove the always-visible "+"; (2) reveal a reaction affordance on message
hover; (3) three quick defaults thumbs-up / heart / fire; (4) a grey smiley opening
the full emoji picker.

## Current state (measured)

- `rxnsInner(list)` (web/index.html ~37295) renders, per room post: existing pills
  (`.rxn`, always visible) + a `.rxn-add` "+" opener + a hidden `.rxn-picker` holding
  the 8-emoji `RXN_QUICK` set.
- The delegated handler on `#pj-room` (~37xxx / 36813-region in old base): `.rxn-add`
  toggles `.rxn-picker`; a `.rxn` or `.rxn-pick` click POSTs to
  `/api/project/:id/room/:postId/react` and repaints the row via `repaintReactions`.
- The COMPOSER already has the exact affordance Josh wants: a grey smiley button
  (`#pj-emoji-btn`, `.emojibtn`, glyph U+1F600) that opens `#pj-emoji` (`.emojipanel`)
  built from `PJ_EMOJI` (76 glyphs) by `pjEmojiBuild` / `pjEmojiOpen`.
- Backend react route + engine are unaffected by a UI change (cli.react-2255 and
  server.projects tests are backend; they stay green).

## Blast radius (reconciled up front)

- ONLY `docs/browser-checks/render-reactions-2255.js` pins the current UI (asserts the
  `.rxn-add` "+" opener + the quick palette). It MUST be updated to the hover design.
- No node test asserts the reaction markup. `bc-surface-map.sh` has no reaction token,
  so the #2518 surface gate has nothing mapped to update.
- Any new/changed browser check must be reconciled against the four guards
  (wired/indexed/reason-grep/selectors) -- the lesson from asks 1+2.

## The change

1. `rxnsInner`: keep the pills (always visible). Replace the `.rxn-add` "+" + the
   8-emoji picker with:
   - a `.rxn-quick` bar (hover-revealed) holding exactly three quick buttons:
     thumbs-up, heart, fire (`.rxn-pick` so the existing react path handles them);
   - a `.rxn-more` grey-smiley button (glyph U+1F600, muted like `.emojibtn-glyph`)
     that opens the full picker;
   - the `.rxn-picker`, now populated with the FULL `PJ_EMOJI` list (so the smiley
     opens "our list of emojis"), hidden by default.
2. Handler: rename the opener match from `.rxn-add` to `.rxn-more` (toggle the
   picker). `.rxn` / `.rxn-pick` react exactly as today. Add outside-click / Escape
   close for the picker (mirror pjEmojiClose behavior) for parity with the composer.
3. CSS: the quick bar + the smiley are hidden until `.msg:hover` OR `.rxns:focus-within`
   (a11y: keyboard users reach them by focus, not only mouse). Existing pills stay
   visible always. Give the row the Discord look: the affordance sits compact,
   appears on hover, does not shift layout (reserve space or use opacity/visibility).
4. Accessibility: the quick buttons + smiley must be focusable and operable by
   keyboard even though they are visually hover-gated (use opacity/visibility that
   still allows focus, or reveal on focus-within). aria-labels on each.

## Verification

- Node suite (web.* + the backend react tests) stays green.
- Update `render-reactions-2255.js`: the "+" is gone; on hover the quick bar shows
  three picks + a grey-smiley `.rxn-more`; the smiley opens the full picker; clicking
  a quick pick adds a pill (count 1, mine); the round-trip toggle-off control holds.
  Add a keyboard/focus-within arm so the a11y path is covered.
- Browser-verify via pw-runtime (hover reveal, smiley opens full list, react works,
  keyboard reachable), light + dark.
- Reconcile the four browser-check guards.

## Weakest premise

That reusing `.rxn-picker` populated with the full `PJ_EMOJI` (rather than sharing the
composer's single `#pj-emoji` panel) is the right structure. Per-row pickers are
simpler and avoid positioning a shared floating panel, at the cost of building the
list per open (cheap, 76 buttons, lazy). If Josh wants the exact composer panel, that
is a later refactor. Shipping the per-row full picker.
