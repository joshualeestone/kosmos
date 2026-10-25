# rereaddiff-7149: a re-read notice says what changed

Card kosmos#7149, ask 1 (from an agent's feedback report). The decision is posted on the card (comment 6404057817). Ask 2, a reopening condition on a task held on a person, overlaps #6683 and is left for that card.

## Decided
1. **A copy of what the agent last read:** `<data>/instruction-reread-seen/<session>.md`, written atomically.
   - At a session start: the report route, on a `started` report, calls `rememberRead`. That is when the agent reads its whole file.
   - When a re-read line lands: passOnce calls `remember` with the text read just before the line. That is what the agent then reads.
   - "Lands" is settle's verdict: PLACED, or UNCONFIRMED (a throw included), which ends the debt as before (review 1). A refused or held line moves nothing.
   - Not while a section is held (switched off): the copy would move past a change not yet announced, so the line names no changes file (review 1).
2. **At delivery:** `prepareChanges` diffs the copy against the file now. It is a whole-file line diff: the common head and tail are trimmed, then LCS over the rest, bounded at 4M cells. Each run of changes is labelled with the nearest heading above it. The output is capped at 160 lines, and says so when cut.
   - The result is written to `.kosmos-instructions-changed.md` in the agent's own folder. The line names it: read those lines first, and the rest of the section only if needed.
   - It is written only after every check that can skip the line.
   - The changes file and the copy both go through securewrite: no symlink followed, mode 0600 (review 1 BLOCKER).
   - An older changes file is removed whenever a notice names none.
   - Headings inside code fences are not sections. CRLF is read as LF.
   - A path holding a double quote is never named.
3. **No change to the line when** there is no copy, the file is unreadable, nothing changed, the diff is too large, or prepareChanges fails. The line is exactly as before.

## Rejected
- **Per-section extraction:** the working rules have no single heading, and policy headings vary by kind.
- **Each writer passing its before and after:** many call sites, and a missed one is a silent gap.
- **The `.previous` copy:** one write back only.

## Weakest premise
That the text read just before the line is what the agent reads after it. A write in between owes its own line, so it appears in the next diff.

## The changes file's place (review 1)
It sits in the agent's own folder, beside the brief it describes. For a connected agent that folder may be the person's repo, but the brief is already there. The changes file holds a subset of the brief's lines, so it exposes nothing the brief does not.

## NOT CLAIMED
- A renamed heading is labelled with the section above it.
- Copies are not removed when an agent is removed or renamed. Each is the size of one brief.
- A person's own edit to the file owes no notice (as before). It appears in the next Kosmos notice's diff unless the agent restarted in between.
- Agents running when this ships have no copy until their next start or their next landed line. Until then, their notices are as before.
- A session name outside `[A-Za-z0-9._-]` keeps no copy, so its notice is as before.
