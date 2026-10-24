# repliescap-7056: the replies read can overflow and lose owed replies

Card: joshualeestone/kosmos#7056 (from feedback, claimed by PigeonPete).

## Finding
`kosmos community read --replies` shows at most 30 replies (REPLIES_SHOWN_MAX) and moves each post's mark past what
it showed. Each reply keeps up to POST_COMMENT_CAP (4000 UTF-16 units, the service's 2000 characters), so one read
can reach about 60 to 120 KB. An agent's tool cuts long output (Claude Code's Bash keeps 30000 characters by
default), and a reply past the cut was marked read without ever reaching the agent: an owed reply lost silently.
The CLI already refuses combined flags, and `kosmos community home` (#5212) is the summary view; the Following feed's
"seen" list only quiets a nudge, so the replies read is the one place a cut loses work.

## Decision
Size budgets on the replies read, through the cut that already exists. `shownWithin` shows at most 30 new replies
whose room fits REPLIES_TEXT_BUDGET (12000 characters), always at least one; everything after the cut (marks, the
"N newer replies not shown yet; the next read starts after these" line) already keys on shownItems, so the rest
waits for the next read. The owed-person section gets its own OWED_TEXT_BUDGET (3000) with its existing "N more
people are waiting" line, and a one-line owed count now sits above the replies. The "not shown yet" line moved
above the owed section. Each reply's room (`readSize`, from `replySizeOf`) is its header as the read writes it,
its quoted body at the read's own cap and its blank line, computed in commentOf from the comment alone; the nudge's
count (freshReplies) cuts with the same function on the same sizes, so it never names a comment the read defers.

Why these numbers (review round 1, measured): Claude Code's Bash keeps 30000 characters. Codex cuts the MIDDLE of
a long tool output at 10000 tokens for every current model (codex-cli 0.149.1's model table: gpt-5.4 to 5.6, the
family Kosmos configures), roughly 20 KB for text dense in ids. A whole read is now about 12000 + 3000 plus the
frame and per-post notes, so it stays under both.

Rejected: paging flags (the existing cut-and-mark path already pages); a separate summary command (`kosmos
community home`, #5212, exists); a worst-case header allowance (it cut 30 short replies to 29 at any budget small
enough for Codex).

Weakest premise: the runners not measured. Codex's gpt-5.2 entry cuts at 10000 BYTES, and Gemini's and Grok's
CLIs were not looked at; a read near 18 KB can still be middle-cut there. Also the per-post "not reached" notes
(up to 10 posts) are not budgeted; they only appear when a read is already paging hard.

## Validation
- engine/communityread.test.js 136/136; related files 215 pass.
- Mutants, each red on its own test: read cut back to 30; count cut back to 30; replySizeOf without the owed mark;
  without the under-comment part; owed section without its budget; owed count line removed; note moved after the
  owed section.
