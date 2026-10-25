# rereaddiff-7149: a re-read notice says what changed

Card kosmos#7149, ask 1 (from an agent's feedback report). The decision is posted on the card (comment 6404057817). Ask 2, a reopening condition on a task held on a person, overlaps #6683 and is left for that card.

## Decided
1. **A copy of what the agent last read:** `<data>/instruction-reread-seen/<session>-<sha256 of the name, 12 hex>.md`, written through securewrite.
   - At a session start: the report route, on a `started` report, calls `rememberRead`. That is when the agent reads its whole file.
   - When a re-read line lands: passOnce calls `remember` with the text read just before the line. That is what the agent then reads.
   - "Lands" is settle's verdict: PLACED, or UNCONFIRMED (a throw included), which ends the debt as before (review 1). A refused or held line moves nothing.
   - Not while a section is held (switched off): the copy would move past a change not yet announced, so the line names no changes file (review 1).
2. **At delivery:** `prepareChanges` diffs the copy against the file now. It is a whole-file line diff: the common head and tail are trimmed, then LCS over the rest, bounded at 4M cells. Each run of changes is labelled with the nearest heading above it. A heading inside a code fence does not count; a fence closes only on a run of the same character, at least as long. The output holds whole lines, capped at 160 lines and 32 KB with the cut note inside both caps. When nothing fits, the notice names no file.
   - The result is written to `.kosmos-instructions-changed-<session>.md` in the agent's own folder. The line names it: read those lines first, and the rest of the section only if needed.
   - It is written only after every check that can skip the line.
   - The changes file and the copy both go through securewrite: no symlink followed, mode 0600 (review 1 BLOCKER).
   - An older changes file is removed whenever a typed line names none (a held section included), and whenever a debt ends without a line (gone, expired, restarted).
   - Headings inside code fences are not sections. CRLF is read as LF.
   - A path holding a double quote is never named.
3. **No change to the line when** there is no copy, the file is unreadable, nothing changed, the diff is too large, or prepareChanges fails. The line is exactly as before.

## Rejected
- **Per-section extraction:** the working rules have no single heading, and policy headings vary by kind.
- **Each writer passing its before and after:** many call sites, and a missed one is a silent gap.
- **The `.previous` copy:** one write back only.

## Weakest premise
That the text read just before the line is what the agent reads after it. A write in between owes its own line, so it appears in the next diff.

## The changes file's place (reviews 1 and 2)
- **Where it lives:** in the agent's own folder, beside the brief it describes, named per session (`.kosmos-instructions-changed-<session>.md`). Two agents sharing a recorded folder each get their own.
- **What it holds that the brief does not:** the lines the person removed. Those are already in the folder, in the brief's `.previous` copy, which `instructions.write` keeps there. For a connected agent the folder may be the person's own repo, so neither file is new exposure for that repo.
- **When it goes:**
  - at the agent's next session start (it read the whole file);
  - whenever a later notice names none;
  - when its files are deleted (delete-leftover forgets the copy too).
- **The copy's name:** it carries a hash of the exact session name, so two names that differ only in case keep two copies on macOS.
- **Size:** whole lines only. An edit past any cut would print as two identical lines. The DIFF is capped at 160 lines and 32 KB instead, with its cut note inside both caps. The file adds a three-line header (review 4).

## A window this does not widen (review 2)
A rewrite that lands after the agent loaded its file, but before its `started` report, gets folded in. The copy is then taken after it, so the next diff omits it. The debt logic already treats a start after the last owe as having read every section, so that change was already never announced. The window and the miss are the same as before this change.

## Order in the diff (review 5)
Within a run, each removed line sits beside the line that replaced it. A cut therefore keeps old and new together, never only the rules that no longer apply.

## Runners without a start report (review 4)
The copy moves at a `started` report and at a landed line. A runner or restart that posts no `started` report leaves the copy older than what the agent read. The next diff then shows MORE than changed since: changes already read are listed again. That errs in the safe direction: nothing is hidden. A start whose copy cannot be renewed drops the copy, so its next notice is as before.

## NOT CLAIMED
- A renamed heading is labelled with the section above it.
- A REMOVED agent (remove.js, which never deletes) keeps its copy, as it keeps its files. Deleting what is left (delete-leftover) forgets it. Sessions are never renamed (only the display name changes), so no file is left under an old name.
- An absolute path is named in the line. A folder path with whitespace, a double quote or a control character is never named, and its notice is as before.
- A person's own edit to the file owes no notice (as before). It appears in the next Kosmos notice's diff unless the agent restarted in between.
- Agents running when this ships have no copy until their next start or their next landed line. Until then, their notices are as before.
- A session name outside `[A-Za-z0-9._-]` keeps no copy, so its notice is as before.
