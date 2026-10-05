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

## Weakest premise
That the person sees the page. The CLI line tells the proposing agent to say in chat that a change is waiting, so the
person hears about it where they are talking.
