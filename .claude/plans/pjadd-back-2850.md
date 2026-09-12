# Plan: #2850 item 1 - hide the "back / All projects" control in the consolidated add-project form

Branch: `pjadd-back-2850`
Card: kosmos#2850 item 1 (Josh, 0.6.57 consolidated-view review)

## What Josh asked for (verbatim)

> We don't need to have the back-and-all projects when I look at adding a project
> from the consolidated view because I'm already right here. Also I want to keep
> the New Project line where it's at. If we delete all projects I don't want it to
> all move up. I like that amount of space that would be up there if we didn't have
> the All Projects button before the New Project text starts.

## The decision

Hide the `← All projects` back control (`#pj-add-back`) on the New project form
(`#pj-add-view`) ONLY in the consolidated layout, with `visibility: hidden`.

`visibility: hidden` (not `display: none`) is the load-bearing choice: it removes
the button from paint, tab order and the accessibility tree, while its box (its
own height plus the `.back` `margin-bottom`) still reserves the same vertical
space. So the New project heading stays exactly where it is and the form does not
move up. That is the literal reading of "keep the New Project line where it's at"
+ "I don't want it to all move up" + "I like that amount of space".

Scoped to `html[data-layout="consolidated"] body.consolidated` so the TAB view
keeps its back button, which there is the only route back to the projects list.

## What I rejected

- `display: none`: would collapse the reserved space and let New project move up,
  which contradicts two of Josh's three sentences.
- Removing the button from the DOM / a JS branch in openAddProject: heavier, and it
  would have to re-add the button for the tab view. A layout-scoped CSS rule is the
  smallest change that satisfies the ask and is trivially reversible.

## Weakest premise

That the add-project form (`#pj-add-view`) renders INSIDE `body.consolidated` when
reached from the consolidated view (vs. the app dropping to the tab layout to show
it). Verified: the file already carries consolidated-scoped rules for `#pj-add-view`
(the min-height/overflow rule near it), and the browser-check drives the real
`openAddProject` under `body.consolidated` and confirms the form is shown there.

## Files

- `web/index.html`: one CSS rule + comment, in the consolidated block.
- `docs/browser-checks/render-pjadd-back-2850.js`: new hermetic check (9 assertions),
  drives the real `openAddProject` in both layouts.
- `tools/browser-checks.sh`: register the check in the run-list.
- `docs/browser-checks/README.md`: index row (required by the indexed test).
- `browser-checks-reason-grep.test.js`: EXPECTED_SITES 101 -> 102 (the check's
  per-problem FAIL loop is one new quotable finding-emit site); EXPECTED_CATCH_SITES
  stays 72 (no launch catch; the top-level catch is multi-line, uncounted).

## Verification

- New check passes (9/9) and was proven to FAIL when the CSS is flipped to
  `visibility: visible` (fails exactly the "consolidated: back button hidden"
  assertion).
- Registry tests (reason-grep, indexed) green.
- Full unit suite green.
