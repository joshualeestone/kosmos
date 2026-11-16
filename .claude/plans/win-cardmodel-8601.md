# win-cardmodel-8601: the card names the model a Claude agent was just changed to, not the old one (kosmos#8601, #8466 first half)

**Posture:** production

## Finished means
On the Windows box: change a Claude agent's model, and its card shows the new model at once and keeps showing it
until (and after) the agent's next turn. Control: a model change on an agent whose job file is not newer than its
transcript (nothing changed) shows exactly what it shows today; a Mac/Linux agent's card behaves as now, or better in
the same way.

## What happens today (measured on the Windows box, 11-16, #8466 comments 6930943623 and 6931019690)
1. The model change rewrites the agent's job (on Windows the Scheduled Task; its file under System32\Tasks gets a new
   mtime) and restarts it.
2. For a moment the agent is STOPPED. server.js plannedFor then reads the job, so the card says the new model as planned.
3. Once it is running again, the card's model comes from engine/status.js readModel: the newest transcript for the
   agent's folder. Claude Code writes a new session file only at its first reply, so the newest transcript is the OLD
   session, whose last reply names the OLD model. readModel returns it as the current model, `modelName` is set, and
   plannedFor returns null for a running agent with a modelName. The card names the old model until the next turn.
4. The #8466 file-time rule (`withoutModelFromBeforeJob`: job newer than the transcript means the reading is from
   before the job) is applied ONLY to Codex readings (readCodexSession). The Claude reading never passes through it.

## Change
- engine/status.js readModel: when the transcript's model was read and the agent's job file is newer than that
  transcript, the reading is from before the job was written. Return it as an earlier reading (`earlierSession: true`,
  the #6716 shape), so `model` is null and the old name travels only as `earlierModelName`. server.js plannedFor then
  reads the job (it does so whenever modelName is null), and the card's existing precedence (web/index.html: modelName,
  then plannedModelName, earlierModelName last) shows the new model.
- The job-file lookup is shared with `withoutModelFromBeforeJob` (one helper returning the job file's mtime for the
  platform), so Codex and Claude cannot drift apart.

## Decisions
- All platforms, not win32 only: the rule is platform-neutral (a job newer than the transcript means the model was
  set after that transcript), the job-file helper already covers launchd, systemd and Task Scheduler, and a Mac agent
  whose plist is rewritten by a model change has the same stale-reading window. Rejected: a win32-only branch, which
  would leave the same window on Mac and a second rule to keep in step.
- Rejected: reading the job's model in status.js for every running agent (the server comment at plannedFor explains
  the per-poll cost); the stat of two files is what the Codex path already pays.
- Known effect: on Windows /Change /DISABLE and /ENABLE also move the task file's time (#8466 note), so a stop/start
  shows the job's (planned) model until the first reply. That is the model it will run, so it is true.

## Weakest premise
That a job file newer than the transcript always means the job's model is the one to show. A job rewritten for
another reason (an account move) keeps the same model, so the planned name equals the old one: no harm. A job with no
--model shows "Claude (its default model)" until the first reply, which is vaguer than the old reading but not false.

## Tests
- New engine/status.cardmodel-8601.test.js: a Claude transcript naming model A, a job file written after it naming B:
  readModel gives earlierSession with A, the snapshot's model null and earlierModelName A; control with the job older
  than the transcript gives model A as today. Plus the platform job-file helper on win32 (task file path).
- Live on the Windows box after merge: the #8466 trace (live8466d.js) shows the planned new model from +2 s on.
