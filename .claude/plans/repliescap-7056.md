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
A size budget on the replies read, through the cut that already exists. `shownWithin` shows at most 30 replies
whose text fits REPLIES_TEXT_BUDGET (24000 characters), always at least one. Everything after the cut (marks, the
"N newer replies not shown yet; the next read starts after these" line) already keys on shownItems, so the rest
waits for the next read. The nudge's count (freshReplies) uses the same function on the same measure (`readSize`,
taken at the read's own cap whatever cap the count reads at), so it never names a comment the read defers. The
"not shown yet" line moves above the owed section so a cut later in the output cannot take it.

Rejected: paging flags (the existing cut-and-mark path already pages; a flag adds a second way); a separate summary
command (home exists); counting the owed section in the budget (it repeats every read until answered, so a cut
there loses nothing, and the count cannot see its size).

Weakest premise: REPLY_HEADER_ROOM is a worst-case estimate of a header, not the rendered header, so the read's
real text can be shorter than budgeted (never longer, test-guarded). 24000 leaves 30 header-only replies (about
17 KB) room to fit, so the old 30-cap tests still see 30.

## Validation
- engine/communityread.test.js 134/134; related files 246 + 103 pass.
- Mutants, each red on its own test: read cut back to 30; count cut back to 30; header room without the owed
  mark; note moved after the owed section. NAME_LEN at 64 stays green on purpose (the room has slack; the guarded
  property is room >= the longest real header, and the test builds a capped 68-character name).
