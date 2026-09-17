# reach-mark-badge (#3212) - question mark over an unreachable agent's avatar (Josh 6.72)

## The ask (Josh, #chaoskosmos-design, 2026-09-17)
Follow-up to removing the room delivery receipt ("placed with X... could not reach Z"). Josh's ruling on how to flag a genuine failure to reach an agent: "if it can't reach someone it puts a question mark icon over their avatar, then we stick with not having to print any status text."

## The change (web/index.html)
- New glyph `LROW_REACH`: a neutral grey question-mark badge (`<span class="lreach">?`), NOT the red-! LROW_WARN (cannot-reach is informational, not an urgent needs-you alarm).
- `pjMember`: `const reachMark = present ? '' : LROW_REACH;` added to the `.pj-face` in both avatar branches, alongside `warn`. Mutually exclusive with `warn` by construction (warn is gated on `m.present === true`).
- `pjMember` caption: the `!present` "We cannot see this agent..." sentence is now gated `hideState ? '' : <small>...`. In the ROOM column (hideState, #3131) the badge carries the meaning so no status text prints; the Settings members list (hideState falsy) keeps the reason for the management view.
- CSS: `.lav .lreach { display: none }` (hidden by default, like `.lwarn`); `.pj-member .pj-face > .lreach { ... }` a small grey corner badge (bottom-right, --k-bg ring) so it annotates the face without hiding it.

The "can't reach" signal is the live `!m.present` state (the board cannot see the agent) - the same state a room post reports as "could not reach". The `.unseen` dashed border is kept.

## What "finished" looks like
- An unreachable (`!present`) member: a `?` badge over its avatar, `.unseen` kept, and in the room column NO status sentence. A present member: no badge. A needs-you member: keeps the red-! triangle, no badge. Settings list: badge + keeps the reason sentence.

## Tests
- docs/browser-checks/render-reach-mark-3212.js (new, self-booting): calls real `pjMember()` for unreachable/present/needs-you members in room + Settings contexts; 8 checks pass. README row added; wired into tools/browser-checks.sh (#1387). Natural negative control: origin/main has no `.lreach`, so the badge arms fail there.

## Collision
No open branch touching pjMember / the members render. Built on origin/main (incl Angel's #3206 tokens and my merged Builds B/D).

## Weakest premise
That Josh means the members surface (his "placed with [4 member agents]" example) and the live `!present` reachability signal, rather than the DM view or a transient per-post delivery mark. The members-pane + `!present` reading best fits his example and is the cleanest live "can't reach" signal; if he wants it tied to an actual send attempt or on the DM header avatar instead, that is a redirect. Flagged to Josh.
