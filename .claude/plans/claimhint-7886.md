# claimhint-7886: a whole-room question says to claim it first (kosmos#7886 item 2)

Finished means: the person's room post that addresses the whole room carries, beside its answer command, one line: "if it
asks for work one of you should do, claim it first: kosmos claim <project> <post-id>", naming the same post.

Why: five agents answered one fresh whole-room question within a minute; later questions were claimed cleanly. The
claim rule is in the agents' instructions (engine/defaults.js), but nothing at the moment of reading the post prompts it.

Decided: the line is conditional ("if it asks for work one of you should do"), because many whole-room posts are
questions any member may answer. Only the person's whole-room arm carries it: the member the person names gets
"message from your operator" and is asked directly; a colleague's post is not a request to the room in the same way.
Rejected: a hard "claim before answering", which would make every member race to claim a question everyone may answer.

Weakest premise: that a line in the envelope changes behaviour. The same mechanism (the answer command in the
envelope) is what made agents answer in the right room; this is the same rung for claiming.

Tests: messages.test.js pins the line on the whole-room arm, that its post id equals the answer command's, and that the
named member's envelope has no claim line (red when the line is removed).
