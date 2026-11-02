# pausedrough-7812 (kosmos#7812, feedback 11-02)

Three rough edges around paused projects, each checked live on 0.7.84 (10ce35b96) before building.

## Built
1. **A paused project flags nobody on its tasks.** `engine/tasks.js` `taskState`: with `projectPaused`, neither
   decision source (an agent needing the person, kosmos#7788's hold for the person) returns 'decision'; the task falls
   through to held, or built for finished work (#5864). The card asked to "clear it on pause, or offer to"; the flag is
   derived each read from the agent's state, not stored, so there is nothing to clear: it simply is not shown while the
   project is paused, and comes back on resume if the agent still needs the person. The agent's own card still shows it.
2. **A resume tells the members.** `engine/messages.js` `tellResumed` types each addressable member, not switched off in
   the project, one `[from Kosmos]` line naming the project and `kosmos task list <id>`. `server.js`'s project edit route
   calls it when `paused` goes from true to false, from either side (the person on the screen, or an agent), after the
   members' instructions are re-synced. Not recorded in the room log: a nudge row needs a post.
3. **The role help states its limit.** `install/kosmos` and `tools/windows/kosmos-cli.js`: "60 characters at most".

## Decided
- Reverses the paused half of a #4771 review test (09-30: a paused project's task needing the person read decision).
  Josh's later ruling (#6341, 10-16: "I don't think we should be flagging users ... when the project's already paused")
  is what the project page follows; the task rows now agree. The held TASK case of that test is unchanged.
- Rejected: a stored "cleared" mark on pause (the flag is derived; a stored mark could go stale against the agent).
- Rejected: posting the resume line as the person (`sendPostAsync` with operator: words they did not write).
- The agent that resumes a project itself is told too; one redundant line, not worth a second rule.

## Weakest premise
That Josh's 10-16 ruling covers the task rows as well as the project page. If he wants a paused project's question to
stay red on the task, revert the two `!paused` guards and the #4771 test change.

## Tests
`engine/pausedrough-7812.test.js` (8). Mutants red: decision ignoring the pause, the for-person hold ignoring it, no
switched-off skip, Windows help without the limit, the route not calling tellResumed.
