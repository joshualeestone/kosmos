# kosmos#8863: the start check covers the send queue, chats and the .jsonl records, and Kosmos keeps a last good copy

Branch `crashcheck-8863`, worktree `~/work/kosmos-crashcheck-8863`, from origin/main 8c193f2a12.

## Measured first (0.8.13, commit 14c4a37364, on a throwaway data root)

| planted | reported by engine/storecheck.js? |
|---|---|
| nothing (control) | checked, 0 damaged |
| settings.json all NUL | yes, "No good copy of it was found" |
| messages.jsonl all NUL | no |
| chats/<agent>.json all NUL | no |
| limitqueue/<agent>.json all NUL | no |
| settings.json all NUL + settings.json.bak | yes, and restore puts it back |

## What changes

1. **Coverage.** `FOLDERS` gains `limitqueue` (messages kept for an agent out of usage, typed after the reset) and
   `chats` (an agent's conversation). The data root's `*.jsonl` files are checked too, judged as append logs: an
   empty one is a normal state and is not reported; a NUL byte is (raw NUL never appears in JSON text, and a crash
   that extended the file before its bytes reached the disk leaves exactly that). All NUL reads `nul` as today; some
   NUL reads a new problem, `nulpart` ("has a blank stretch, as a crash can leave a file; what was written there is
   lost"). Lines are not parsed: a torn line is what an ordinary append crash or a concurrent writer leaves, and the
   readers already skip it. No repair is offered for a `.jsonl`: the board keeps appending, so the existing "saved
   since start" guard would refuse any put-back, and an older copy would drop every record since it. A log is read
   only in its last 8 MB (review 3), where a crash leaves its blank stretch, so a long log is never reported as too
   large and never read whole at start; NULs further back are not seen. Nothing repairs a log, so when the person
   dismisses the note, how far each named log's NULs reach is kept in damaged-logs-seen.json (review 5); a later
   start names that log again only for NULs past that point.
2. **A last good copy.** After the start scan, and every 24 hours, each ALLOWED `.json` store that reads as GOOD is
   copied to `<data>/last-good/<same relative path>` with `securewrite.writeSecret` at the store's own mode (flushed,
   then renamed: a crash mid-copy leaves the old copy or the new, never a blank one) and given the store's own
   modified time. Allowed, by name (reviews 1 and 3): settings, projects, you, instruction-adds, agent-stars,
   first-run, agent-language and autoupdate, and the profiles and catalogue folders. Left out on purpose: secrets;
   the send queue (limitqueue: a copy put back would type delivered messages again); chats and commitments, which
   "Delete your history" (engine/forget.js) deletes for good, so a copy would survive the forget (a test reads
   forget's KINDS and fails if one is ever copied); and stores whose older copy would undo something the person took
   back: removed agents, policies, limits, joined computers (federation), the Community choice, the Kosmos list
   (worlds) and the community folder. None over
   8 MB, none this run found damaged. Unchanged stores are skipped by comparing content. Copies whose store is gone or
   no longer allowed are removed in the same pass. The copying is NOT part of the start check (review 2): it runs a
   minute after start and then daily, one store per turn of the event loop. Measured on a copy of a busy board's
   allowed stores (137 files, about 5 MB): a first pass at once took 5.0 s on the board's one thread, because every
   copy is flushed; an unchanged second pass took 19 ms. `goodCopy` offers it as a
   candidate beside the existing `.bak` / `.prev` / temp copies, newest first, so the page's existing Put back works.
   When it is the one offered, it is first kept as `<file>.recovered-<when>` beside the store (review 5), as a crash's
   temp copy already was, because the next copy pass replaces last-good/ and the page says where the copy is kept.
   No copy is written through a last-good/ that is a link.
3. **Page.** `DAMAGED_PROBLEM` gains `nulpart`.

## Rejected

- A `.prev` on every write: every writer in the engine changes, and every write doubles.
- Copying the whole data folder: secrets, and gigabytes of attachments.
- Parsing every `.jsonl` line: cost at every start on a 4 MB+ file, and false alarms for a torn line.

## Weakest premises

- A Windows crash leaves the same NUL shape as an APFS one (NTFS reads extended-but-unwritten bytes as zeros). The
  tests plant the bytes, not a crash.
- One generation of last-good copy: a store damaged by a crash, then saved over as empty by a reader in a later run,
  can have its copy refreshed with that empty value at the next start. This run's damaged stores are never refreshed,
  and the person sees the notice at the start that found the damage.

- Review 2, deferred: a store damaged MID-RUN and then saved over as empty, which the daily pass would copy. NUL
  damage comes from the computer going down, which also restarts the board, so the start scan sees it first and that
  store is never refreshed this run. A writer outside the board failing without a flush is the residual.
- Review 4, deferred: the start scan now also reads the chats and limitqueue files whole. Measured on a copy of a busy
  board's stores (37 such files, 0.9 MB): the scan took 9 to 12 ms on main and 10 to 16 ms with this change.

## Done when

A planted zeroed `settings.json` with a last-good copy is named and put back from it; a zeroed `limitqueue` file, a
zeroed `chats` file and a part-NUL `messages.jsonl` are named; a clean start names nothing (control); sensitive stores
get no last-good copy.
