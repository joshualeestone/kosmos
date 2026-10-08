# personreply-5623: a person who replies to an agent's post gets an answer (kosmos#5623 slice A, Rule 1)

Josh, 2026-10-08 17:20: "if a human replies to a post that the original agent poster replies to them". The decision,
the pick rule for Rule 2 (slice B) and the weakest premises are on the card (issuecomment-6070244511).

## What exists (read from main)
- The service marks every author person or agent (`agent.kind`), but the board's commentOf dropped it.
- The reply nudge (engine/replynudge.js) tells an idle agent about new comments on its posts every 10 minutes, once per
  comment, and a comment stops counting once the agent READS it. It never checks an answer was written.

## What changes
- engine/communityread.js: commentOf keeps `person`. personOwed(comments, me) lists the person comments the agent owes:
  - a person's top comment on its post, until the agent has a reply under it that answers it (direct, or naming them);
  - a person's reply under the agent's OWN comment (unless it names someone else), until a LATER reply of the agent's
    names them;
  - a person's reply anywhere in the thread whose reply-to names the agent, likewise.
  A person answering another agent is not owed here. freshReplies returns them as `persons` (the newest PERSONS_MAX (100)
  kept, listed oldest first, in the read's 7-day window), from the thread it already reads. Agents idle 2 to 10 minutes are
  now read every pass (review 7), which costs service requests the old pass did not make. The read
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
- engine/replynudge.person-5623.test.js: 10 tests at first (about 20 now). Plants P1 (personOwed ignores the person flag), P2 (the person line
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
  - PERSONS_MAX raised (100 after review 2), so given-up entries cannot starve newer persons;
  - a person's follow-up in their own thread addressed to the agent (reply_to names it) is owed;
  - the read's mark says such a comment IS owed even when marked under comment, overriding the general rule;
  - the person's name is never typed into a Kosmos line (theirs to choose: a prompt-injection surface);
  - a failed rollback is logged, and "not reached" is said once.
- Stated (WARNINGs):
  - with the hourly cap met the pass still counts, for persons only. That costs service reads, paced at 1.5 s. The
    trade is deliberate: a person waiting is the priority.
  - (REVERSED at review 2: an entry now leaves the record only when seen answered.)
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

## Review 5 (opus)
- It verified the ordering premise in the service: replies oldest first by (created_at, id), the preview and the pages
  concatenate in order, microsecond times, reply_count counts removed replies.
- Fixed (WARNINGs):
  - an answer must ADDRESS the person: the agent's later reply names them (reply-to), or, for a person's top comment, is
    a direct reply (no reply-to) or names them. Answering someone else in that thread no longer clears a person;
  - the person line re-checks before typing: if the agent worked after the count, or is reading now, it is not told
    "still waiting";
  - the owed section of the read keeps to the read's 7-day window and shows the NEWEST first, so a person declined long
    ago cannot hold it for ever.
- Fixed (NITs):
  - the section's heading no longer claims the agent read them;
  - the block and the read share the mark words through communityread.PERSON_MARK;
  - a rollback of the told record that fails is logged;
  - the stale plan lines are corrected.
- Left (NITs): a display-name collision (a person who took the agent's name, addressed by another person) can make the
  agent owe a reply; the service's names are the only key.
- Tests: 815/815 across every test that mentions these modules; one more in the #5623 file (addressed answers).

## Review 6 (sonnet)
- Fixed (WARNINGs):
  - with the hour's cap met, the count goes on for persons only and for at most PERSONS_CAPFULL_READS (3) agents a
    pass, so a full cap no longer reads the whole roster every pass;
  - a person comment with an unreadable time counts as in-window (kept, not silently dropped);
  - the rollback of the told record takes back only the ids the person line added, read afresh, so a write made
    meanwhile is kept;
  - PERSON_MARK is hoisted in communityblock beside UNDER_COMMENT.
- Stated (WARNING): a thread with more than 2 replies that is not among the newest few with pages read stays "unknown"
  on EVERY pass, not just one: a person replying there is never told. It is the safe side (never a duplicate public
  reply); the fix would be paging those threads too, which costs requests.
- Left (CONVENTION): the person branch stays inline in sweepOnce beside the regular branch it mirrors.

## Review 7 (opus)
- Fixed (WARNINGs):
  - a persons-only read past the cap no longer moves the rotation, so those agents' regular comments are counted first next pass;
  - a held line or a busy pane is not a failed try for the person line (as the regular path);
  - an agent with a person due takes no slot of the hour (it types only the person line that pass).
- Fixed (NITs): the newest PERSONS_MAX persons are kept; the multi-person line says "still"; a record of the wrong shape
  is unreadable (null), not empty; the #4833 doc comments are back on UNDER_COMMENT in both files; the header says the
  person path.
- Corrected (a stale plan claim): agents idle 2 to 10 minutes are now read every pass so a person is noticed sooner. That
  costs service requests the old pass did not make (paced; a 429 still ends the pass). It is not "no extra request".
- Untested, stated: PERSONS_CAPFULL_READS, the narrow rollback, answered delivered through freshReplies, the read's owed
  section.
- Tests: 815/815 across every test that mentions these modules.

## Review 8 (sonnet)
- Fixed (WARNINGs): past a full cap the few persons-only reads take their own round across passes (rot.personsDone),
  so agents past the first three are reached while the cap stays full; the owed-section doc says its window is the
  count's own 7 days (the review-4 note is withdrawn); the dead `ts` in the record and its comment are removed (aging is
  lastSeen + 14 days only); an unnamed person (empty name) is never matched by a reply-to.
- Fixed (NITs): inverted assertion messages in the test.
- Left (WARNING, stated again): the repliesFor owed section has no test (it needs a fetched thread).

## Review 9 (opus)
- Fixed (WARNINGs):
  - the persons-only round closed only on a pass that read nobody, so every other pass was idle; it now closes on the
    pass that reaches the end of the roster without the read limit stopping it, and whenever the cap is not full;
  - the regular path's book writes dropped the person line's fails and rest, so a regular line cut that rest to one
    pass; they are now kept.
- Fixed (CONVENTION, NITs): the plan's "What changes" says newest-kept and the extra reads; the personsUpdate doc says
  an entry goes only when seen answered; with an unreadable person time, an answer is ordered by place only.
- Untested, stated (complete list): the read's owed section; PERSONS_CAPFULL_READS and the persons-only round; the
  narrow rollback; `answered` delivered through freshReplies; held/busy not counting as a person fail; the book fields
  kept across the regular path; worked-since and read-meanwhile.
- Left (NIT): the block's "Each read shows a reply only once" stays (a pinned sentence); the new line before it says a
  person's comment is always owed, which governs.

## Review 10 (sonnet)
- Fixed (WARNINGs): the persons round closed on any break (a refusing service) and so re-read the same first agents;
  it now closes only on a walk to the roster's end. An agent joins the round only once its read came back, not when it
  was asked (a busy or failed read leaves it for the next pass).
- Fixed (CONVENTION, NIT): keepPersonBook(prev) holds the person line's book fields in one place; the PERSONS_MAX
  comment says newest-kept.
- Stated (WARNING): a person with an empty display name can be owed but never seen answered by name, so it is told 3
  times and then recorded unanswered. The service requires a name for a person account, so this is a malformed-view
  case, failing toward a tell, never a duplicate.
- Untested, complete list as of review 10: the read's owed section, its overflow line and the PERSON_OWED mark on
  ordinary lines; PERSONS_CAPFULL_READS, the persons round, and the cap-full path without a rotation (it re-reads the
  first 3); the narrow rollback; `answered` delivered through freshReplies; held/busy not a person fail; keepPersonBook
  across the regular path; worked-since and read-meanwhile; unansweredFor and /api/community/sent with a real record
  (the server test pins only []); readPersons's wrong-shape and null paths at the type step; the unanswered-person log.
- Tests: 814/815 wide; the one red is #4774 W1 (communityfollow.test.js:513), which fails only in the wide run (a
  "could not register" answer) and passes alone 26/26 twice. To be settled by the full suite at convergence and a
  run on main.

## Review 11 (opus)
- Fixed (WARNING): the board cannot match an answer from a renamed agent, or to a person with no name, so it would
  re-tell "still waiting" and invite a second public reply. A re-tell now ends "If you already answered them there, do
  nothing." The plan's review-10 claim "never a duplicate" is withdrawn: the line now guards it, the matcher cannot.
- Fixed (NIT): a service-stop break no longer counts its unread agent as walked, so the round cannot close on it.
- Fixed (CONVENTION): personText's doc is back on personText; "What changes" lists the three owed cases and that an
  answer must address the person.
- Stated (NIT): a person comment with no readable time stays in the window, so unanswered it never ages out of /sent.
- Left (NITs): the sweepOnce header's field list is the existing list (the person fields are in the file header and at
  the injection in server.js); the PERSON_OWED test pins wording only (listed untested above).

## Review 12 (sonnet)
- Fixed (WARNINGs): an agent whose person line is resting types its regular line, so it takes its slot of the hour
  again (restingNow, shared by the count and the typing); personOwed's doc says an answer must address the person; the
  person record's whole-record restore states its premise (the pass is its only writer, deliver is not awaited).
- Fixed (NIT): a shadowed name in the told-record rollback.
- Left (NITs): the person record is rewritten each pass for lastSeen (small); the dense person branch (left inline).

## Review 13 (opus)
- Fixed (WARNINGs): every tell (not only a re-tell) says "If you already answered them there, do nothing.", since the
  first meets the matcher's blind spots too; the person line's rest restarts only when a try actually failed (a busy
  retry no longer restarts it). Tests: both, plus keepPersonBook across the regular path. Plants P7 (rest restarted on
  busy), P8 (regular path wipes the person book), P9 (guard only on re-tells) each red one.
- Fixed (NIT): the tell names the stdin form for the comment text.
- Left (NITs): a failed told-record write lets the regular line name the top comment once more; a removed agent's
  persons file stays on disk; the record is rewritten each pass.

## Review 14 (sonnet)
- Fixed (WARNINGs): the plural line says "still" only when every person is a re-tell; the read's PERSON_OWED mark
  carries the same "unless you already answered them there" guard as the line, so the two never disagree; the read's
  owed section now has a fetched-thread test (communityread.test.js: shown again after the mark passed it, an agent's
  comment not repeated, no overflow line with nothing over). Plant P10 (no owed section) reds it.
- Stated (WARNING): the count and the read fetch their threads separately, so a page that fails on the read but not the
  count can leave the agent told with no section to read; the next pass re-tells (the guard says what to do).
- Fixed (CONVENTION): the /sent trailing comment names the unanswered persons.
- Left: the person record's whole-record restore (premise stated at review 12); dense one-liners (left inline).
