# Plan: adoption disk-scan offer, placement + letterbox (#2025)

Branch: `adoption-restyle-2025`. Card: kosmos#2025. Lane: design/presentation (Mona Lisa).
Design spec: `Josh-Brain/Projects/kosmos-adoption-offer-restyle-2025-design-spec.md`.

## Goal (what will be true when done)

- The disk-scan adoption offer (`#scan-wrap`, feature #1938) shows **only on the Agents tab**, never
  on Projects, the create forms, or any Settings page, and never above the operator's own agents in
  the consolidated view.
- A scanned CLAUDE.md preview reads without a **horizontal scrollbar** (no letterbox): long prose
  wraps, and a long unbroken token (a pasted path) breaks rather than overflowing.
- A committed browser check asserts both, and fails against the pre-fix code (a real positive control).

## Why (Josh, 2026-09-03, with screenshots)

Josh reported the offer "appears everywhere" and that its file preview is read "through a letterbox".
Re-measured against current `main`: the #1938 rework already gave the panel real `.btn.uprime` rows,
identity-first content, and a toggle + arming dismiss head, so the older "unstyled / raw anchor tags /
three actions" complaints are already addressed. Two defects survive and are this plan's scope.

## Approach (exact `#found-wrap` mirrors, low risk, not new mechanism)

1. **Placement.** `#scan-wrap` is hidden nowhere on the way off the Agents tab, and the 5s poll is
   gated to the Agents tab, so once shown it persists on every other tab.
   - Add `document.getElementById('scan-wrap').hidden = true;` in the `if (!agents)` branch of
     `showTab`, beside the existing `found-wrap` line.
   - Add `#scan-wrap` to the consolidated-view hide CSS selector, beside `#found-wrap`/`#removed-wrap`/
     `#restart-wrap`.
2. **Letterbox.** `.fr-scanpreview` was `white-space: pre` → horizontal scrollbar.
   - Change to `white-space: pre-wrap; overflow-wrap: anywhere` (the pairing the file's other preview
     surfaces at :465 and :3789 use). The bounded `max-height: 16rem` vertical scroll is unchanged.

## Out of scope (deliberate)

- The panel-head `.linkish` toggle + arming "Dismiss this forever": a deliberate mirror of
  `#found-wrap`'s head (Josh approved the arming dismiss 2026-08-24). Diverging scan's head alone would
  break that symmetry; if it should become filled buttons, that is a call for both heads together.
- Whether the disk scan should offer a cleanly-named agent at all: an engine decision on #1938, not
  this presentation fix.

## Test plan

- Extend `docs/browser-checks/render-scan-board.js`: (a) no horizontal letterbox, behavioural
  (`scrollWidth <= clientWidth + 2`) on a long prose line and a long unbroken path, plus the computed
  `white-space`; (b) the panel hides on an in-page tab switch, read synchronously at 300ms (well under
  the 5s poll, so it measures the handler not the poll) with an `onAgentsTab === false` cross-check.
- Positive control: run the same check against `origin/main`, and both new assertions must FAIL there.
- Full repo suite (node + shell gate) green; challenge-loop to convergence.
