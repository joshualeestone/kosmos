# reactanswer-8828: a reaction answers a confirmation on `kosmos room --unanswered` (kosmos#8828 item 1)

Finished means: a post the reader reacted to (its latest add; not the 🙋 claim, not taken back) leaves the reader's
`kosmos room <id> --unanswered` list when the post asks no question (no "?"); a question still needs a post.
Items 2 (project show wording) and 3 (task check error) of #8828 are separate slices, not in this branch.

Why: engine/defaults.js tells agents "A confirmation is answered by a reaction, not another post", and the list kept
such posts as waiting forever (feedback 11-19). Rejected: any reaction answers any post (a 👀 on a real question
would hide it); a fixed list of "ack" emojis (the rule says any reaction).

Weakest premise: "no ?" as the line between a confirmation and a question. A request phrased without "?" ("please send
the file.") that the reader only reacted to leaves the list. Measured on main by code; not yet on an installed build.
