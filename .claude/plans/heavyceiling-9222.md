# kosmos#9222: a --pid job whose process is confirmed running outlives the 12 h ceiling

Follow-up to kosmos#9217 slice 1 (branch heavyjob-9217), round 8's open WARNING, filed under Splinter's usage rule.

## Problem

`engine/heavyjobs.js` `isLive` dropped every record 12 hours after its last announcement, even when its `--pid`
process was confirmed running (signal 0 says alive and the ps start time matches the one recorded). An overnight run
longer than 12 hours left the board while it ran, which is when the line matters most.

## Change

`isLive` becomes `judge`, which says what one read does with a record: show it, hide it (not shown, not counted toward
the per-agent cap, but left in the file), or drop it.
- A `--pid` record that recorded its process's start time is judged by that start, with no ceiling: the same start is
  the same process, shown while it runs (an overnight run stays); a different one is a reused number, dropped.
- When the start is unread on a read (undefined: signal 0 answers, but ps was over the read's budget, timed out, or
  not asked): shown inside the ceiling; past it, HIDDEN but kept, so a read that could not ask neither deletes what the
  next one confirms nor shows what it cannot vouch for.
- So that aged records get their reads: a read judges aged records first, and only a ps run spends its budget (a
  fresh cache hit, or a process signal 0 says is gone, costs none). In `start()`, up to four of the agent's aged
  records get a real read, each pid asked once however many times it is judged.
- A hidden record still counts toward the agent's four, so an agent cannot fill the file with them.
- A hidden record is listed by `GET /api/heavy` (so `kosmos heavy`, on both CLIs) marked unchecked, with its pid and
  how to end it, so a job an agent is told it still has, or that holds one of its four places, is one it can see and
  end. The board's note shows only checked jobs. "Not read" is never cached, so the next read asks ps again.
- Known edge, not handled: a job announced again while ps cannot answer records no start, so it loses this protection
  and meets the ceiling 12 h after that announcement.
- The ceiling still drops a record with no process, and one that recorded no start (Windows, no ps).
- A hung wrapper that never exits is kept on purpose: it is still running, and still holding what it holds. It is
  ended with `kosmos heavy end --pid N`.

## Rejected

- Raising the ceiling: it would still drop a long run, and keep records nothing can judge longer.
- Renewing `at` on each confirmed read: a write per poll, for the same result.
- Keeping an unread aged record SHOWN (round 1's fix): a record whose start goes unread on every read (ps failing,
  an unreadable /proc) would then stay on the board for ever, even after its number went to another process.

## Weakest premise

That a matching start time is proof of the same process. A reused number given the same start second is the only way
it lies, which ps's lstart (to the second) makes very unlikely. And: a record that ps can never read again stays in
the file, hidden, until signal 0 says its process is gone; it is invisible, and it holds one of its agent's four
places (so `kosmos heavy start` refuses a fifth until one is ended with `kosmos heavy end --pid N`).

## Tests

engine/heavyjobs-9217.test.js: a confirmed process at 13 h stays; a different start goes; no recorded start at 13 h
goes; a job with no process at 13 h goes (control); an unread start at 13 h is hidden but kept, and shown again on the
next read that confirms it. With the real defaultStartOf: a later start by the same agent keeps the overnight record,
also while ps cannot answer; aged records are read first (an overnight job written after nine fresh ones is
confirmed); a fresh cache hit costs no ps read; and when other aged records spend the budget, the overnight job is
hidden for that read but kept. Every one of those arms was mutated to red.
