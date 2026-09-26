# #3880: All tasks (consolidated view) without its outer rounded box

## Finished looks like
- In the consolidated view, the All tasks screen has no outer rounded box: the title, "+ New task",
  filters, tiles and list sit on the column's ground, in the same place. Tiles and list rows keep
  their own borders. The tab view (Tasks tab) keeps its frame, since its project rail sits inside it.
- render-tasks-view-3559.js asserts both halves (consolidated: 0px border, 0 radius, transparent
  ground, tiles still bordered; tab view: 1px/14px frame kept), and fails on main's CSS (measured).
- Served build shows it; before/after shots on the card.

## The call
- The box is `.tsk-view`'s own border/radius/background (#3559). Dropped only under the consolidated
  relocation selector, beside the rule that already folds its rail there.
- Rejected: removing it everywhere (Josh scoped it to the consolidated view; the tab view's frame
  holds the rail and the main column together).
- Weakest premise: "the rounded box" is `.tsk-view` and not some other wrapper. The screenshot's box
  starts just left of the title and wraps New task and the list, which is exactly `.tsk-view`'s edge
  in the column (the rail is hidden there, so the view is one column).
