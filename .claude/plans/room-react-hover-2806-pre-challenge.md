---
pre_challenge: true
method: challenge-loop
branch: room-react-hover-2806
diff_hash: ce3da7df4771691ab28d69a70649e17bb78f9c1704312254e1a21b6b6f88eb21
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T21:33:19Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviewer passes (opus). **Converged:** iteration 3 found no
BLOCKER; its one WARNING is a scaling optimization deferred to kosmos#2834 with the
fix approach documented; its NITs are fixed or consciously accepted.

Card #2806 ask 3: Discord-style hover emoji reactions on room posts. The "+" opener
is gone; on message hover a `.rxn-quick` bar reveals three defaults (thumbs-up / heart
/ fire) plus a grey smiley that opens the full `PJ_EMOJI` picker.

### Iteration 1 (opus) -- BLOCKER: picker clipped by the thread overflow

The full picker was `position:absolute` anchored to the `.rxns` row, so the room
thread's `overflow:auto` clipped it -- on the bottom (most-reacted-to) post it opened
below the thread edge and was invisible. FIXED (fa234e4e): `position:fixed` +
`rxnPositionPicker` (positions from the smiley's rect, flips above when no room below,
clamps to the viewport); a scroll listener closes it since a fixed popover does not
follow the thread. Also flagged, and fixed: the check could not reproduce the clip
(single post near the top) -> the check now posts 16 messages, runs on the bottom
post, and asserts the picker is actually VISIBLE via an elementFromPoint hit-test
(getBoundingClientRect cannot see overflow clipping). Proven red-capable by pushing
the picker off-screen. Added the quick-default react arm (the headline ask) and an
outside-click close arm.

### Iteration 2 (opus) -- BLOCKER: scrolling inside the picker closed it

The capture-phase scroll listener closed the picker on ANY scroll, including a scroll
inside the picker's own emoji grid (overflow-y:auto, taller than its max-height), so
the lower emoji rows were unreachable. FIXED (e252ba9f): skip scrolls whose target is
inside a `.rxn-picker`, and gate the close on an actually-open picker. Added two check
arms -- a scroll inside the picker keeps it open (proven red-capable by removing the
guard), and a control that an outside scroll still closes it.

### Iteration 3 (opus) -- CONVERGED (no BLOCKER)

Confirmed both prior fixes are correct and do not interact badly: the scroll listener
handles the in-picker target, the thread-ancestor target, and the document (nodeType
9) target correctly and defensively; the three document listeners are registered once
and do not double-close; the synthetic-scroll check arms are faithful proxies for real
scrolls; the min-count guard is consistent.
- [WARNING] the full 80-emoji picker is inlined into every room post (~84 buttons/row
  vs 9 before), rebuilt as a string on each paintRoom. DECISION: deferred to
  kosmos#2834 with the shared-picker fix approach (mirror the composer's `pjEmojiBuild`
  single-panel pattern). Rationale: functionally correct today (the reviewer's words);
  setLive diffs the DOM writes so only the string-build repeats per poll; the fix is a
  substantial refactor of an interaction already hardened through two BLOCKER fixes,
  with real new-bug risk and zero current user impact (Kosmos beta, no users). Weakest
  premise: if rooms grow very large before #2834 lands there could be jank; measure
  before refactoring.
- [NIT] the scroll-gate comment overstated "does no work" -> reworded (6686c852).
- [NIT] the check does not exercise the document-target (nodeType 9) scroll branch ->
  accepted: the room is an overflow container so a window-level scroll is unlikely, and
  the branch is defensively written (`nodeType===1` gates `.closest`, so no throw).

## Validation

- 1463 node tests pass (web.*, cli.react-2255, server.projects, and the four
  browser-check guards).
- `render-reactions-2255.js` (rewritten for the hover design) passes 36 assertions in
  light + dark via pw-runtime, run on the BOTTOM post of a scrolled 16-message thread:
  no "+", three quick defaults, the hover reveal, a quick-default reacting, the smiley
  opening the full picker, the picker VISIBLE on the bottom post (hit-test), a picker
  react, the toggle-off controls, Escape and outside-click closing, a scroll inside the
  picker NOT closing it, and a control that an outside scroll does. Two regression
  guards proven red-capable by perturbation.
- The four browser-check guards reconciled (wired / indexed / reason-grep / selectors).
- Browser-check gates #1720 and #2518 pass.

## Scope

Ask 3 only (asks 1+2 shipped in #2824). The DOM-weight optimization is kosmos#2834.

## Outstanding questions

None.
