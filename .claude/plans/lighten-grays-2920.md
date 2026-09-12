# Plan: Lighten the idle-agent gray (#2920)

## Source
Josh, 6.59 QA notes 2026-09-12 (verbatim): "I feel like the gray behind agents when they're idle is just a little too dark and maybe the same with their message too. We might adjust the grays so that we get a little bit lighter."

## The two surfaces
- **Idle-agent gray**: `#pj-one-agents .pj-member.pjm-idle` (web/index.html) paints a `linear-gradient` overlay of `rgba(120,120,128,.10)` over `var(--k-surface)`; hover is `.16`. This is the only idle-keyed background in the file (`.astate.st-idle` is a border-color only). Rendered effective color on white was ~rgb(242).
- **Agent-message gray**: the agent bubble (`.dm.theirs`, and its room sibling `.pj-msg`) takes `--k-sunk` (#2805). `--k-sunk` is `rgba(20,22,26,.05)` light (~rgb(243) on white), and is a SHARED token (inline code pills `.mdc`/`.mdcb`, other sunk surfaces).

## Decision (make-the-call, Josh's standing ruling)
- **Lighten the idle gray**: `.pjm-idle` overlay `.10 -> .07` (effective ~rgb(242) -> ~rgb(246) on white), hover `.16 -> .12` (kept proportionally above the rest state). Verified visually with a headless-Chrome swatch comparison: the new idle and hover read a touch lighter while staying subtle ("a little bit lighter").
- **Leave the agent-message gray as-is.** Reasons, so Josh can overrule: (1) his ask for the message is tentative ("maybe", "we might"); (2) the message already uses `--k-sunk` at `.05` (~rgb(243)), which is already about as light as the newly-lightened idle gray, so it is not the "too dark" surface; (3) `--k-sunk` is a shared token, so lightening it globally would also lighten code pills and other sunk surfaces, wider than the ask; (4) the #2805 comment in this file explicitly warns that lightening the agent bubble further re-opens the "bubble dissolves into the white panel" defect (a too-light `.theirs` fill was LESS visible than the default it overrode). If Josh still wants the message lighter after seeing the idle fix, the follow-up is a message-scoped tint (not the shared token), tuned to stay clear of that dissolve.

## Gate
Visual-only CSS value change, no behavior. The `.pjm-idle` overlay lives in `background-image` (a gradient), which the browser-checks' `getComputedStyle().backgroundColor` / `__kbg` compositor cannot read, so a scripted color assertion would be brittle. `server.test.js` guards the `pjm-idle` CLASS assignment (unaffected). Satisfying #1720 with a `Browser-check:` trailer documenting the local swatch verification.

## Done-condition
The idle-agent member row reads a touch lighter (idle `.07`, hover `.12`); no other surface changes; full suite green; CI green.

## Weakest premise
That `.pjm-idle` (the project-members roster) is the "gray behind agents when they're idle" Josh means. It is the only idle-keyed background in web/index.html; the state border (`.st-idle`) is not a fill. If he meant a different surface, this is a one-line redirect.
