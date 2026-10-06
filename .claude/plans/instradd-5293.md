# #5293: an agent proposes an addition to another agent's instructions; the person applies it on the page

## The report (day-one, community kosmos-bugs, 2026-10-05)
A manager agent drafted a ~15-line addition to a colleague's instructions and the person said "apply it". No command
could: `kosmos agent` offers create, roles and role-draft. The agent rightly would not call board routes by hand, so
the person pasted it in on the colleague's page.

## Design (approved by Splinter 10:00; page look by Mona Lisa 10:12, card comment 5997165007)
1. **The agent proposes.** `kosmos agent instructions-add "<name>" --from <file>` (Mac and Windows CLIs). The board
   holds it as the target's ONE pending addition: the text, who asked (resolved like /api/msg: the agent token, else
   the caller's pane, never a name the caller types), and when. Nothing is applied. The CLI prints Mona's line:
   "Held. The person applies it on <name>'s page in Kosmos; nothing changes until they do."
2. **One pending per target (Splinter).** A second proposal is REFUSED, never replaces the first:
   "Not sent: <name> already has an addition waiting, asked by <agent> on <date>. The person can apply or dismiss it
   on <name>'s page first."
3. **The person applies it on the page.** Under the Instructions box and Save, "Waiting for you", the community held
   row reused exactly: bold "An addition to these instructions", the text clamped to 4 lines with Read all when cut, a
   meta line (who asked, when, what Apply does), Apply and Dismiss. Apply, Dismiss and Undo are person-only routes
   (isViaScreen, the gate community release uses: an agent token is refused, browser headers required). Honest limit,
   as there: a speed bump, not a wall, until #4491 keeps the board token out of agents' reach.
4. **Apply** appends, at the end of the instructions, a line saying who asked and when, then the text. It writes
   through engine/instructions.write with the version just read (a concurrent edit is refused, not overwritten) and
   records the write as the person's. It keeps the text from just before, and the version written.
5. **Undo** restores exactly that earlier text, only while the instructions are still the version Apply wrote. If
   they were edited since, the page says so (Mona's sentence) and offers no button.
6. The page's existing running-stale note handles "this agent is running older instructions", with its Restart.

## Where things live
- engine/instructionadds.js: the store (`instruction-adds.json` under the data root), propose / pending / apply /
  dismiss / undo / state. Keyed by instructions.registryKey(name).
- server.js: POST /api/agent/<name>/instruction-add (propose; agent token or pane), GET .../instruction-add (the
  page's read), POST .../instruction-add/apply, /dismiss, /undo (person-only).
- install/kosmos, tools/windows/kosmos-cli.js: `kosmos agent instructions-add`.
- web/index.html: the row on the agent's Instructions panel.

## Limits
- One pending per target. Text: non-empty, at most 16 KB, shown as text (never rendered HTML).
- The target must be one of this board's agents (claimantFor, so a look-alike session cannot be targeted). An agent
  may not propose to itself? It may: a person still has to apply it.

## Review 1 (opus, blind)
- BLOCKER fixed: the store was keyed by the raw URL spelling; a case variant the gate accepts was stored apart, shown
  nowhere, and let a second addition wait beside the first. The route now resolves the spelling to the one agent
  (claimantFor) and keys by its session name. Test: a proposal to "Mara" shows on mara's page and blocks a second.
- W2 fixed: propose is an everyday agent route, so it joins AGENT_TOKEN_ROUTE_PATTERNS (an agent with only its own
  token can propose on an enforcing board; apply still refused). W3 fixed: removing an agent forgets its entry.
- NITs fixed: null-prototype map; an unparseable store is refused, never overwritten; Undo is not offered when the
  earlier text is below the instructions' minimum; the store is mode 600; its path is resolved per call; Read all
  ignores a trailing newline; a press whose addition is already gone repaints; the Mac CLI strips a BOM like Windows.
- W1 ACCEPTED, stated: on a Mac agent with no token, the asker is resolved from the caller's pane, as every Mac
  message's sender is (/api/msg, /api/post). A process holding the board token could name another agent's pane, so
  "asked by" is a label with the same trust as a message's sender, not an authority. The person still reads the text
  and decides. Refusing the pane fallback (denyPaneFallback) would refuse every Mac agent that has no token today.

## Review 2 (sonnet, blind)
- W fixed: an unreadable store was a dead end, and silent. Now the page says so, and the next write MOVES it aside
  (instruction-adds.json.unreadable-<time>, kept, never deleted) and goes on from empty. An empty file or {} is just
  empty. Test: the kept copy is byte-identical to the broken one.
- W fixed: Apply wrote the instructions, then the store; if the store write failed, a retry added the text twice with
  no Undo. Now a failed record takes the addition back out (only if nothing wrote since) and says so. Mutation: no
  take-back reds the test.
- NITs fixed: forget removes every capitalisation of the name; the route refuses rather than key by a raw spelling.

## Review 3 (opus, blind): round 2's fixes went too far, so they were SIMPLIFIED, not patched again
- A read ERROR (EMFILE, EACCES) was treated as corruption, and the next write (even an agent's removal) moved a GOOD
  store aside. Now a read error is BUSY: writes refuse, nothing moves. Only a file that reads but cannot be PARSED is
  set aside, and the fresh store records the kept file's name; the page names it for a day. Test: chmod 000 refuses
  and moves nothing.
- The take-back write could itself fail (MIN_CHARS, a version sentinel) and was swallowed under "nothing changed".
  Replaced by an IDEMPOTENT apply: if the file already ends with exactly this addition, it is only recorded. A failed
  record says "press Apply again to finish; it will not be added twice", which is now true. Mutation: without the
  idempotency check, the retry test reds.
- Undo state is read from the FILE: back at the earlier text means undone, even if recording the undo failed. Only a
  real sha256 version can guard an Undo. The page names the actual reason Undo is not offered (edited / too short /
  unknown), never "edited" when nobody edited.

## Review 4 (sonnet, blind)
- W fixed: idempotency matched on day + asker only, so a same-day re-proposal of the same words was skipped and its
  first Undo record lost. Each proposal now has an id, written in a comment under the heading; only that proposal
  matches. Test: the same words proposed again after an apply are added again.
- W fixed: moving a corrupt store aside is recorded at once (the fresh store names the kept file), whatever the calling
  write does next. W fixed: the 'unrecorded' sentence states its condition (the instructions not changed first).
- NITs accepted: in the rare finished-retry path, Undo restores the earlier text with one trailing newline (the exact
  original trailing whitespace is not known there); a hand-edit back to the earlier text reads as undone.

## Review 5 (opus, blind)
- W fixed (present since round 1): an addition could carry Kosmos's own managed-block markers (<!-- kosmos:projects:start
  -->), giving the target two blocks and stopping its projects / doctrine sync for good. propose refuses any <!-- or -->,
  as engine/catalogue.js refuses a role text with a comment. Mutation: without it, the test reds.
- Decided, not refused: {{...}} template markers (catalogue refuses those too). Kosmos fills {{NAME}} only when an agent
  is created, so in a later addition they are inert text.
- NITs fixed: two comments said more than was measured.

## Review 6 (opus, blind): the rebase onto main e645859f9
- Main's #5297 board-start community refresh rewrites the instructions file without anybody editing it, so the
  version check read as "edited". FIXED 762e44ad9: Apply and Undo match the addition's own span. DECIDED (card): an edit
  ELSEWHERE no longer blocks Undo; an edit INSIDE the addition still refuses.

## Review 7 (opus, blind): the 762e44ad9 fix
- W: projects.removeBlock takes the blank lines on both sides of Kosmos's block, which are the addition's own leading
  blank lines when it sits right after the block: Undo read "edited", and a second Apply press added it twice. FIXED
  7d5ac53c1: matched from the heading line, exactly once, at a line start. Tests go through the real spliceBlock /
  removeBlock. "Short" is judged on the text Undo would write. The queued runs at 762e44ad9 were withdrawn.

## Review 8 (sonnet, blind)
- W: a second press that found the addition but not exactly once recorded the file as "before", so the page said
  undone with the addition there. FIXED e43918961 (refused, code 'edited'). Exact-text tests for Undo with the block
  after the addition and with nothing above it. A redundant no-head branch dropped (no test could tell it apart).

## Review 9 (opus, blind): the state is read from the file alone
- W: a retry after an edit to the addition's TEXT added it twice. W: undone, then an earlier version restored: the
  page said undone with the addition there and Undo refused. W: an Undo whose record failed after a block refresh
  read "edited". REDESIGNED 974f853e2 rather than patched: whereIs reads the file only. Exactly once as written:
  'here'; the id line absent: 'gone' (taken out, by Undo or by hand); the id line present otherwise: 'changed';
  unreadable: 'unknown'. The whole-file restore (before/version) is gone: unreachable once the span is matched, and
  the feature is unmerged, so no record needs it. Proposals cannot hold comments, so the id line is Kosmos's own.
- The page's sentences now say only what each state means (4b8d2750b): taken out ("the rest is as it was"), changed
  or copied, too short to keep. The browser check asserts the new undone sentence.
- Found while checking: the browser-check surface gate was red since the feature commit (the earlier full run died
  on the temp-dir leak before reaching it). Per-check trailers in 0a4123bef, each with its reason.
- Mutations, each red: the apply refusal, tracing by core only, all-absent as changed, Undo's changed and gone
  refusals, short, undone from the record, unreadable as unknown. Related files 265/265.
- DECIDED: lines the person types directly under the addition are theirs and survive Undo (pinned).

## Weakest premise
That the person sees the page. The CLI line tells the proposing agent to say in chat that a change is waiting, so the
person hears about it where they are talking.
