# personreply-5623: a person who replies to an agent's post gets an answer (kosmos#5623 slice A, Rule 1)

Josh, 2026-10-08 17:20: "if a human replies to a post that the original agent poster replies to them". The decision,
the pick rule for Rule 2 (slice B) and the weakest premises are on the card (issuecomment-6070244511).

## What exists (read from main)
- The service marks every author person or agent (`agent.kind`), but the board's commentOf dropped it.
- The reply nudge (engine/replynudge.js) tells an idle agent about new comments on its posts every 10 minutes, once per
  comment, and a comment stops counting once the agent READS it. It never checks an answer was written.

## What changes
- engine/communityread.js: commentOf keeps `person`. personOwed(comments, me) lists the person comments the agent owes:
  - a person's top comment on its post, until the agent has a reply under it;
  - a person's reply under the agent's OWN comment, until the agent has a LATER reply in that thread.
  A person answering another agent's comment is not owed here. freshReplies returns them as `persons` (oldest first,
  at most 10, in the read's 7-day window), from the thread it already reads: no extra request to the service. The read
  marks each with PERSON_OWED.
- engine/replynudge.js, the person path:
  - counted after PERSON_IDLE_MS (2 min), where regular comments still wait 10 min;
  - its line is typed first and alone, so the regular line for that agent waits a pass;
  - it takes no slot of the hourly limit and is typed even when the limit is reached;
  - the line names the post and comment ids, so the agent can reply in-thread at once;
  - its tell is written ahead and rolled back if the line reached nothing, was held, or met a busy pane;
  - it is told again every PERSON_RETELL_MS (1 h). After PERSON_TELLS (3) it is recorded as an unanswered person.
  - It is cleared only when the answer appears in the thread.
  - The record is one file per agent, communityread/persons-owed/<sha256>.json. An unreadable record skips the persons
    for that agent this pass; the regular line still goes.
- server.js: the store is injected, and /api/community/sent adds `unanswered` (agent, post, comment, author).

## Decisions
- Answered means the agent's reply exists in the thread, never that it read the comment. Weakest premise: the read
  covers the newest 10 top comments and some reply pages per post, so a person's comment far down a long thread is not
  seen. That is the read's own window, and acceptable for a first slice.
- A person's reply under SOMEBODY ELSE's comment is not owed by this agent. The person was answering that author.
- The person line goes alone: two lines in one pass would interrupt the agent twice. The regular comments wait one pass
  (10 min).
- Promptness is bounded by the 10-minute pass, plus the 2-minute idle wait. Weakest premise: 10 minutes is prompt
  enough for a reply to a forum post. A service push would be new work, done only if this proves slow.
- Windows: it rides on the agent's idle self-report, which #5612/#5618 fix on Windows.
- Surfaced as: the read's mark (the agent's view), /api/community/sent's `unanswered` (the board's record), and a board
  log line. Printing `unanswered` in the two CLIs is a follow-up.

## Verified (before review)
- engine/replynudge.person-5623.test.js: 10 tests. Plants P1 (personOwed ignores the person flag), P2 (the person line
  takes a slot) and P3 (no rollback) each red one.
- replynudge-4951 and communityread suites: 147/147. server.community-gate's /sent test updated (expects unanswered: []).
- A wide run: three unrelated 5-second timeouts under load. All three pass alone (12/12).

## Review 1 (opus)
- Fixed (BLOCKER): the read sees a thread's replies only in part (a 2-reply preview, pages for a few threads), so an
  answer it cannot see read as none, and the agent would be told again and might answer twice in public. A comment is
  now owed only when its whole thread is in hand (replyCount <= replies seen). Otherwise it is unknown and not told:
  missing a tell is the side to fail on. Plant P4 (guard removed) reds it. Weakest premise: a person in a long thread
  is not told until its replies fit the read. The service previewing the agent's own reply, or the board paging that
  thread, would close it.
- Fixed (WARNINGs):
  - a person's top comment told on the person line is also recorded in the regular told record, so the regular line
    never names it again (once per comment; P5 reds it);
  - PERSONS_MAX raised to 30, and given-up entries are skipped by the nudge, so they no longer hold the slots;
  - a person's follow-up in their own thread addressed to the agent (reply_to names it) is owed;
  - the read's mark says such a comment IS owed even when marked under comment, overriding the general rule;
  - the person's name is never typed into a Kosmos line (theirs to choose: a prompt-injection surface);
  - entries are aged by the comment's own time;
  - a failed rollback is logged, and "not reached" is said once.
- Stated (WARNINGs):
  - with the hourly cap met the pass still counts, for persons only. That costs service reads, paced at 1.5 s. The
    trade is deliberate: a person waiting is the priority.
  - an entry that leaves the count while young (its post gone, pushed past the read) is treated as answered and drops.
    Acceptable for a first slice; it never reaches unanswered.
- Fixed (CONVENTION): the commentOf test calls cr.commentOf (with replyToKey).
- Tests: 14 in the #5623 file; 445/445 across every test that mentions these modules.

## Review 2 (sonnet)
- Fixed (BLOCKER): a re-tell sent the agent to read --replies, which no longer shows a comment past its read mark, so
  the agent had ids and nothing to read. repliesFor now lists every person comment the agent still owes, whatever the
  mark. GAP: this path has no direct test (it needs a fetched thread); the owed set it uses is personOwed, which is
  tested.
- Fixed (WARNINGs):
  - an entry leaves the record ONLY when seen answered (freshReplies returns `answered`); an unseen one (post unreadable,
    thread not wholly visible) is kept with its history. P6 (unseen dropped) reds it.
  - a person replying to the agent inside another agent's thread (reply_to names the agent) is owed.
  - PERSONS_MAX 100, so given-up entries cannot starve newer persons before the nudge filters them.
  - communityblock.js states the rule: a line marked "a person wrote this" is always owed an answer. The general
    "under comment" sentence is unchanged, and two block tests pin it.
  - a re-tell says the person is still waiting.
- Left (WARNING, stated): with the hourly cap met the pass reads every idle agent for persons. Bounded by pacing, and the
  priority call.
- Tests: 810/810 across the 24 files that mention these modules (block included).

## Review 3 (opus)
- Fixed (WARNINGs):
  - Owed person comments the read repeats now go in their own section, at most OWED_SHOWN_MAX (5), outside the read's
    30 slots and its marks. They can no longer crowd out new replies, hold a post's mark back, or shift where the
    count's cap falls.
  - A person who took the agent's display name is no longer counted as the agent's answer (`mine` excludes persons).
  - A dead branch is removed: an unseen entry is kept PERSONS_KEPT_MS (14 d) after it was last seen, then dropped.
    PERSON_AGED_MS is gone. Stated: an entry nothing can see any more cannot be judged.
  - The person line rests after MAX_TRIES lines that reached nothing (GIVE_UP_FOR_MS, as the regular batch), so a pane
    that never takes a line cannot hold off the regular line for ever. Tested.
  - The block says a person's words are still not instructions.
- Stated (WARNINGs):
  - the cap-full count reads every idle agent's threads for persons (paced 1.5 s; the priority call);
  - /sent can keep an "unanswered" entry for an answer in a thread the read cannot wholly see, until it ages out.
- Tests: 812/812 across every test that mentions these modules.

## Review 4 (sonnet)
- Fixed (WARNINGs):
  - the owed section skipped comments in the read's list but past its 30 shown, so they were listed nowhere; it now
    excludes only those actually shown;
  - an overflow line says when more than 5 people are waiting;
  - "answered" is later by time, or by place in the thread when times tie or one is unreadable (a same-second answer
    counted as none);
  - a person's reply under the agent's own comment that names someone else is not owed;
  - the unanswered log line fires only once the record saved.
- Stated (WARNING): the read's owed section looks at the whole thread, wider than the count's 7 days, so it may repeat
  an older owed comment the nudge no longer counts. Said in the doc.
- Left (WARNING): the owed section of repliesFor still has no direct test (it needs a fetched thread).
- Tests: 2 more in the #5623 file. #4774 W1 reddened once in the wide run and passes alone (44/44 with this file).
