# #3898: guard esc() on the subtasks UI's new strings (April's review of #3885)

## Finished looks like
- web.subtasks-3861.test.js feeds a markup-shaped sentence (and parent sentence) through each new path
  that reaches innerHTML, using the page's REAL esc(): the Tasks view row and its crumb, the project
  column card and its crumb, the task page's Subtasks list (and its textContent Part of line), and
  New task's Part of picker. Each asserts the text arrives escaped, with a control (a pass-through esc)
  that must see the raw tag, so a path that stopped rendering cannot pass by accident.
- Measured: removing esc() from a crumb in web/index.html reds the test.
- #3898's other four items were already fixed on main (April read the PR's first commit of a rebase
  merge); the card says so, checked by content.

## Calls
- Test only; no product change. Rejected: a browser check (the unit lift covers every path and runs in
  npm test, where a regression is caught on every PR).
