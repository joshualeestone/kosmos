# kosmos#8344: the stale-instructions triangle wraps under the name in My Agents

The name button became a block so a long name would truncate, which pushed the triangle after it onto its own line.

The call: make the name's wrapper a flex row. The name shrinks and truncates, the triangle keeps its size beside it.

Rejected: an inline-block name, because a long name would then push the triangle out of the row.

Weakest premise: only the stale triangle sits there today. Anything else added beside the name gets the same no-shrink treatment.
