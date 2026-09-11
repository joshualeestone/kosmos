# project-needsyou-2699: make a needs-you member stand out on the project view (kosmos#2699)

Addresses kosmos#2699 (Josh, design channel 2026-09-10, a josh-review design-capture card).

## Problem

Josh's exact words: "if they need something from me, it does say the 'needs you' text on the agent view but on the project view I should be able to see it. It just says 'needs you' in text and doesn't show... it's in the same spot where Idle, Idle, and Working are. We really want to call out that it needs you so you can notice it. I think originally we were going to put the little red triangle over the top of the agent's icon, and maybe we make the 'Needs You' text in red."

On the project view, each member row (`pjMember`, used by paintOneProject and paintSettingsMembers) draws an avatar (`.pj-face`) and a plain `<small>` status ("Needs you" / "Idle" / "Working"). The needs-you state has no visual emphasis, so it blends into the Idle/Working spot. The agents LIST already draws the red warning triangle (`LROW_WARN`) over its avatars; the project member roster does not.

## The fix (scoped, presentation only)

In `pjMember`:
- `const needsYou = (m.present || m.state === 'restarting') && stateCopyOf(m).attn === true;` - `attn` is true only for `needs_you` in STATE_COPY, and only the present branch shows a state word (an unseen member says why instead), so this lights up exactly the needs-you-and-visible case.
- Put `LROW_WARN` (the same warning triangle the list uses) inside the `.pj-face` span when `needsYou`.
- Add class `pj-attn` to the status `<small>` when `needsYou`.

CSS (scoped to `.pj-member`, so no other `.lav` triangle or `small` changes):
- `LROW_WARN` is `display:none` inside any `.lav` by the base rule, so show it for `.pj-member .pj-face > .lwarn` and position it over the avatar, reusing the consolidated list's 18x16 centered placement; give `.pj-face` `position:relative; overflow:visible` so the triangle escapes the circular avatar.
- `.pj-member small.pj-attn { color: #b3261e }`, lifted to `#ff8c82` in both dark spellings (system `@media` guarded by `:not([data-theme="light"])`, and the explicit `[data-theme="dark"]` toggle) - the same WCAG-AA lift `.pjonode.attn` already uses, since `#b3261e` is a ~2:1 whisper on the dark surface.

## Rejected

- Restyling `.lav .lwarn` / `.pj-face` globally: rejected. `.lav`/`.lwarn` are shared by the agents list, the room, the org nodes; a global show would light triangles everywhere. Scoped to `.pj-member`.
- Only reddening the text (no triangle) or only the triangle (no red): rejected. Josh asked for both ("red triangle over the icon, and make the text red"), and either alone is weaker.
- Bolding the status text: not asked; kept to red only, minimal.
- Touching the Map-node rollup (`pjMapNode`) or the project-card pill (`pjPillOf`): those are project-LEVEL rollups; Josh's "the agent's icon" + "Idle, Idle, and Working" is the per-agent roster, which is `pjMember`. Out of scope.

## Verification

- `docs/browser-checks/render-project-needsyou-2699.js` (new): hermetic file://, calls the real `pjMember()` for a `needs_you` member and an `idle` member, injects both, reads computed DOM. Asserts the needs-you triangle is present, not `display:none`, and overlaps the avatar; the status `<small>` has `pj-attn` and a distinct (red) color from idle; the row reads "Needs you"; and the NEGATIVE arm that an idle member gets neither. Every arm proven can-fail (drop the emit / leave display:none / drop the red).
- Wiring guards reconciled: reason-grep 95->97 finding-emit and 65->67 catch/launch (this check's r.error + fail.join, and its launch catch + top-level .catch), README index row, browser-checks.sh no-URL loop entry.

## Weakest premise

No screenshot on the card, so "project view" is inferred from Josh's words. I read "over the top of the agent's icon" + "Idle, Idle, and Working" (multiple agents each with a status) as the per-agent member roster (`pjMember`), not the project-level Map node or card pill. If Josh meant one of those rollups instead, this lights up the wrong surface. Mitigation: `pjMember` is the only project surface that draws a per-AGENT icon beside a per-agent Idle/Working/needs-you status, which is exactly what his words describe.

## Release-cut note

If a cut is active when this is ready, HOLD the merge (render surface) until staging-ready, per the merges-pause-during-a-cut rule. As of building, Baron's 0.6.55 cut is DONE and main is unfrozen.
