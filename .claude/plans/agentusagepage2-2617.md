# Token Usage page: the "By agent" block, post-review follow-up (kosmos#2617)

This branch carries the changes made after Mona's styling review of PR #3603.
#3603 (the block itself, through challenge-loop iteration 6) merged as 4951aeae
while these were in review, so this branch is main plus the four follow-up
commits, cherry-picked unchanged:

1. Mona's defect: the two non-agent row labels are fixed sentences and now wrap
   instead of being cut short; agent names keep the ellipsis and title.
2. Iteration 7: display-name collisions count only agents that get a row.
3. Iteration 8: the per-agent and history blocks share one heading rule.
4. Iteration 9: each share table is its own size container, so the narrow
   layout keys on the table and also fires beside the donut at half width.

The design and its reasoning are in `.claude/plans/agentusagepage-2617.md`,
which these commits keep current. The review record for iterations 1-10 is in
`.claude/plans/agentusagepage2-2617-pre-challenge.md`.

## Verification
- `web.token-usage-2617.test.js` (unit, real renderers).
- `docs/browser-checks/render-token-usage-2617.js`: passes on this branch and
  fails on main's page on exactly the three follow-up assertions (label in full
  at 1280, at 390, model table narrow beside the donut).
