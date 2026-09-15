# Plan: breadcrumb spacing + clickable-no-underline crumbs (#3125)

Josh 6.68 feedback. Two changes to the project-detail breadcrumb (tab view):
1. Add space around the slash: "Kosmos Inside Out  /  Security Audit", not ".../...".
2. Make each ancestor crumb CLICKABLE to jump straight to that project, with NO underline.

## Done-condition
- The breadcrumb slash has clear breathing room on both sides.
- Clicking an ancestor crumb opens that project (via openProject); Enter/Space work too.
- Ancestor crumbs carry no underline.
- The current ("you are here") crumb is not a link.
- No regression to the #2928 ellipsis-truncation protection (current name protected).

## Approach (chosen)
- Spacing via CSS `margin` on `.pj-crumb-sep` (not text spaces) so it is one tunable place and
  never double-counts with collapsed inline whitespace. Rejected: adding more literal spaces to
  the separator string (fragile, whitespace-collapse-dependent).
- Clickable ancestors: render each ancestor-with-id as a `.pj-crumb-link role=link data-project`
  span; wire a delegated `#pj-crumb` handler -> `openProject(id)`, mirroring the list card's
  proven `data-project` -> `openProject` pattern. Rejected: per-render listeners (rebind churn),
  and modifying `pjAncestry` to return ids (it is used elsewhere; higher blast radius). Build the
  id-bearing ancestor chain inline instead, mirroring `pjAncestry`'s guards.
- Current crumb stays plain text (you are already there). Ancestors only are the jump targets.
- Unloaded parent (`p.parentName`, no id) renders as plain text, never a dead link.

## Weakest premise
That ancestors-only (not the current crumb) is what Josh means by "make them clickable." Mitigated:
the current crumb clicking would be a no-op (you are on it), so ancestors-only is the useful and
conventional reading; trivially extended if Josh wants the current clickable too.

## Verification
- Full node suite + surface gates (local).
- render-subprojects-1994.js extended with executable, non-vacuous assertions (clickable ancestors
  root-to-current; current not a link; sep margin > 0; clicking an ancestor navigates), run by the
  CI browser-checks job.
- Blind challenge-loop to convergence.
