# projusage-6842 (board): kosmos#6842 slice 3, per-project token use in the Enterprise rollup (board half)

Coordinator half: kosmos-relay branch projusage-6842. Full plan on kosmos#6842 (comment of 2026-10-21 19:09Z).

## What
- engine/orgenroll.js: NAMES_PROJECT_USAGE (/\beach project's finished tasks\b/i); acceptedConsent gains
  projectUsageConsented when an accepted line carries it and a NAMES_USAGE word.
- engine/orgrollup.js: projectUsageByDay reads the receipts (receipt.forTask, 3 at a time) of tasks closed in the last
  7 days, for projects the rollup sends, into tokens per (project name, close day, model). build() turns it into
  projectUsage rows with cost from usageprice; at most 200, costliest first; the size trim takes them first.
  Daily sends only. A read that is slow (60 s), throws or is the wrong shape sends no field (not reported), never [];
  an incomplete read (a receipt failed, partial, or an agent unreadable) marks the body truncated.

## Decided
- From task receipts (finished work), not usage by folder: one agent works on several projects, so folder use cannot be
  split by project.
- Close day, not hold days: a receipt is a finished task's total; splitting it by day would invent precision.
- Inert until the coordinator's words and check ship (the coordinator ignores unknown fields today).

- Only the enrolled Kosmos sends projectUsage (the read runs in its tick). Other Kosmoses on the same computer leave it
  out, which reads as not reported, never as none (challenge iteration 1).
- At most 200 tasks are read per tick, newest first; more marks the read incomplete (iteration 1).
- A size trim that takes every project row leaves the field out, never [] (iteration 1).

## Residuals, stated
- An agent that holds parts of two tasks at the same time has those tokens on both receipts (each receipt counts the
  agent's transcript inside its own hold spans), so a sum over tasks can count them twice. This holds for slice 2's
  project total and for this rollup alike; the console labels spend as estimated. De-duplicating spans per agent across
  tasks is a separate change (challenge iteration 1).

- A read that is incomplete (capped, partial, or an agent whose work cannot be read) still sends its rows, and the
  coordinator replaces the stored week with them. The body says truncated, which makes the member "partial" in the
  console, and the console now carries that state with the project numbers ("partial" in the drawer). Merging per
  (project, day) on the coordinator instead was rejected: it would keep rows for tasks since reopened or deleted
  (challenge iteration 2).
- An agent whose work cannot be read (removed, or a provider with no receipt) on a task closed in the last 7 days keeps
  the daily body truncated until that task ages out. Conservative and true: that work is unknown (iteration 2).

- An agent on a provider with no receipt (Grok, Antigravity, Muse) is not counted and does not make the read incomplete,
  as the task page shows it; marking it incomplete would make that member "partial" everywhere for as long as such
  tasks keep closing (iteration 3).
- Projects that could not be listed leave project use not reported, never []; a task whose close cannot be read is left
  out and marks the read incomplete (iteration 3).
- The console shows numbers only where rows exist, so "never reported" and "reported none" both show nothing next to a
  project. Telling them apart needs a stored "reported at" per Kosmos, a separate change (iteration 3).

## Weakest premise
That reading up to a week of receipts inside the daily tick is fast enough. Kept receipts are one file read each; an
unkept one reads transcripts once and is then kept.

## Verify
- engine/orgrollup-projusage-6842.test.js (15); mutants caught: read on a change send; per-day usage trimmed before
  project rows. orgrollup-5532 and enroll tests pass with acceptedConsent's new key.
