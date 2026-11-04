# claimhint-7886: a whole-room question says to claim it first (kosmos#7886 item 2)

Finished means: the person's room post that addresses the whole room carries, beside its answer command, one line: "if it
asks for work one of you should do, claim it first: kosmos claim <project> <post-id>", naming the same post.

Why: five agents answered one fresh whole-room question within a minute; later questions were claimed cleanly. The
claim rule is in the agents' instructions (engine/defaults.js), but nothing at the moment of reading the post prompts it.

Decided: the line is conditional ("if it asks for work one of you should do"), because many whole-room posts are
questions any member may answer. It appears exactly when react()'s claim guard would accept any member's claim: the
guard's "who is asked" rule moved unchanged into one helper, claimAskedMembers, and the envelope calls it on the row
the post becomes (review round 3: a local copy of the rule disagreed with the guard on "@leo is out, can someone take
it?", on ambiguous @-words, and on a member who has left). Also not in a room shared with another computer (a claim
there is this computer's alone), and not when no reply is wanted.
Rejected: a hard "claim before answering", which would make every member race to claim a question everyone may answer;
and a second copy of the asked rule, which drifted from the guard within two review rounds.

Weakest premise: that a line in the envelope changes behaviour. The same mechanism (the answer command in the
envelope) is what made agents answer in the right room; this is the same rung for claiming.

Tests: messages.test.js pins, against the real react() claim guard, that the line appears exactly where an unnamed
member's claim is accepted (three posts: named, named but asking the room, naming nobody); it also pins the line on every member's envelope for a post that names nobody, with the same post id as
the answer command; and no envelope carries it for a post that names leo (red when the line is removed, or ungated);
and none for an FYI post, a shared room, or a reply to an agent's post, each against a control that carries it.
