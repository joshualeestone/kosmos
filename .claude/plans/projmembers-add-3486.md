# #3486 — Consolidated "Project Members +" opens nothing (live 0.6.89 bug)

## The bug
In the CONSOLIDATED view, with a project open, the "Project Members" rail head shows a `+`.
Josh clicks it and nothing pops up. The add-agents dialog works fine from the project/tab view.
Reopened as a LIVE bug (Splinter 14:24) after an earlier "already fixed" verdict that rested on a
forced-state render.

## Root cause (measured, not inferred)
The add-member modal `#am-modal` was **authored inside `.pjcard-members`** (the project's Members
card, web/index.html ~11847). `#3305` hides that card in the consolidated view:

```
html[data-layout="consolidated"] body.consolidated .pj3 > .pjsplit > .pjcard-members { display: none; }
```

`display:none` on an ancestor removes the **entire subtree** from rendering, including a
`position:fixed` descendant. So the rail `+` handler fired correctly (`#am-modal.hidden = false`),
but the modal rendered as a **0×0 box** — hidden===false yet nothing on screen.

Proven with a real headless render of the app (real openProject → paintAgentList → grouping →
`#rail-agents-new` click → `openAddMemberModal`):
- `#am-modal` opened in place (inside `.pjcard-members`) → offsetW/H = **0×0**.
- The same `#am-modal` reparented to `<body>` → **1280×900**, visibly rendered with the picker.
- Its DOM parent was `DIV.pjcard.pjcard-members` with `display:none`.

Why the earlier "already fixed" was wrong: it (and the existing #3387 browser-check) asserted the
`hidden` **attribute**, which flips regardless of an ancestor's `display:none`. The attribute is
not the experience.

## The fix (decided)
Move the `#am-modal` block **out of `.pjcard-members`** to the top-level `.rm-back` modal cluster,
beside every other modal (near `#rm-modal`, ~line 10059). A full-screen overlay opened from the rail
is not part of the card and must not share its display state. All ids/nesting are preserved
(`#pj-one-add-row` stays inside `#am-modal`), so `paintFreeAgentPicker`, the go handler, and
`amClose` keep working by id from anywhere.

Guaranteed by construction: the modal is no longer under any hideable project-panel ancestor, so it
cannot be suppressed by this rule or any future project-card display state.

## Rejected alternatives
- **Runtime reparent to `<body>` on open** (1-line JS portal): works, but a workaround for a
  structural placement bug; the codebase convention is to author every `.rm-back` modal at top
  level, so fixing the placement is cleaner and convention-consistent.
- **Stop using `display:none` on `.pjcard-members`** (hide differently): reintroduces #3305's
  concern (the members card taking space / showing in consolidated) and is a wider blast radius.

## Regression guard
`render-project-members-3387.js` assertion 2 only checked `modal.hidden === false` — it passed
through the whole bug. Added a `#3486` assertion that reads the modal's **rendered box dimensions**
(`> 200 × > 80`) after the consolidated rail `+` click. It fails on the old (suppressed) markup and
passes on the fix. Added `am-modal pjcard-members` to that check's surface annotation so this surface
is guarded going forward.

`render-addmem-flash-2429.js` declares `pj-one-add-go` (a token inside the moved block); its flash
behavior is unaffected by the relocation and it re-runs green — carried as a per-check surface
override trailer, not a code change.

## Weakest premise
My reproduction is a headless render with mocked APIs, not Josh's exact clean-room build. The root
cause (display:none ancestor → 0×0 fixed modal) is a CSS/DOM invariant that does not depend on the
data, and the fix is verified by the modal rendering 1280×900 with the picker populated. What would
change my mind: the promoted build still shows a dead `+` after this ships — which would mean a
SECOND suppression path I have not found (none seen: `#am-modal` now has no hideable ancestor).
