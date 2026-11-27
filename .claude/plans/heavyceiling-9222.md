# kosmos#9222: a --pid job whose process is confirmed running outlives the 12 h ceiling

Follow-up to kosmos#9217 slice 1 (branch heavyjob-9217), round 8's open WARNING, filed under Splinter's usage rule.

## Problem

`engine/heavyjobs.js` `isLive` dropped every record 12 hours after its last announcement, even when its `--pid`
process was confirmed running (signal 0 says alive and the ps start time matches the one recorded). An overnight run
longer than 12 hours left the board while it ran, which is when the line matters most.

## Change

In `isLive`, a `--pid` record that recorded its process's start time is judged by it, with no ceiling: a different start
is a reused number and it goes; an unread start this time (undefined: the process answers signal 0, but ps was over
budget, timed out, or not asked, as in `start()` for the agent's other records) keeps it, so one read that could not
ask never deletes what the next would confirm. The ceiling still applies to a record with no process, and to one that
recorded no start (Windows, no ps): a start read later cannot confirm one that recorded none.
A hung wrapper that never exits is kept on purpose: it is still running, and still holding what it holds.

## Rejected

- Raising the ceiling: it would still drop a long run, and keep records nothing can judge longer.
- Renewing `at` on each confirmed read: a write per poll, for the same result.

## Weakest premise

That a matching start time is proof of the same process. A reused number given the same start second is the only way
it lies, which ps's lstart (to the second) makes very unlikely. A process past the ps budget of one read is judged by
the cache or not at all; an uncached one in that case meets the ceiling like any unjudged record.

## Tests

engine/heavyjobs-9217.test.js: a confirmed process at 13 h stays; an unread start at 13 h stays; a different start
goes; no recorded start at 13 h goes; a job with no process at 13 h goes (control). With the real defaultStartOf: a
second start() by the same agent at 13 h keeps the overnight record, and so does a live() that spends its eight ps reads
on older records first (a control asserts the eight were spent before it).
