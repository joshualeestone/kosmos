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

## Weakest premise
That the person sees the page. The CLI line tells the proposing agent to say in chat that a change is waiting, so the
person hears about it where they are talking.
