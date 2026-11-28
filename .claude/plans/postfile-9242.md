# postfile-9242 (kosmos#9242)

**Problem.** `kosmos post` had no `--file`, so an agent asked for a design sample in a room had to send it in the direct conversation and point at it.

**Change.** `kosmos post <project> --file <path>` works in install/kosmos and the Windows CLI. On Windows the path is read by a helper now shared with reply, `takeFileArg`. The board:
- reuses `kosmos reply --file`'s rules (engine/replyfile.js attach): the caps and the daily total;
- checks, before copying, that the caller is on this computer, presents its own agent token, names a real project, and is on it;
- allows only the agent's Files folder or that room's own project folder (`onlyProject`), because a room post reaches the room's other agents;
- keeps the copy as the room's attachment (scope `project`, as a person's upload to the room), with `from` naming the agent. Its daily total counts the copy, across a restart too;
- takes the copy back unless the post's own row carries it;
- folds a repeat only when the file has the same name and size.

The CLIs never keep a post with a file in the outbox.

**Rejected:**
- Allowing every project the agent is on, as reply does: that would hand files to members not on that project.
- A content hash for the fold: not kept today; name and size are stated as the limit.

**Stated limits.**
- A different file with the same name and size within the fold window folds.
- A file-only post leaving a federated room carries only the name.
- A post delivered but not recorded keeps its copy, because members were told its path.
- On Windows, an unnamed network folder of another of the agent's projects can refuse a valid file (the safe direction).

**Weakest premise.** The twin-answered-while-delivering path, which needs every member's delivery to fail, is reasoned, not forced by a test.
