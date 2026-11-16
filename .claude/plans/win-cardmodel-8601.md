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
- engine/status.js readModel: the transcript's model is read as an EARLIER reading (`earlierSession: true`, the #6716
  shape) when BOTH hold: the agent's job file was written after that transcript (`writtenBeforeJob`, two stats), AND
  the job names a different Claude model (`jobNamesAnotherModel`, via create.plannedModelOf, read only after a
  rewrite). Then `model` is null and the old name travels only as `earlierModelName`; server.js plannedFor reads the
  job whenever modelName is null, and the card's existing precedence (modelName, then plannedModelName, earlierModelName
  last) shows the new model.
- The job-file lookup is one helper (`writtenBeforeJob`) shared with the Codex rule (`withoutModelFromBeforeJob`).

## Decisions
- Review 1: NOT the file time alone. On Windows every start, stop and restart moves the task file's time
  (/Change /DISABLE and /ENABLE, the supervisor resuming the same conversation), and an account move or provider switch
  rewrites the job on every platform, all with the model unchanged. Time alone blanked the model, the context ring
  (limitFor(null)) and whoami's answer after every Windows restart. So the job must also NAME a different model.
- Only a full `claude-...` id in the job is compared (what the picker writes). A job with no model or a short name
  ("opus") cannot be compared with a transcript's full id, so the reading stands, as before. Same model: equal once a
  "[1m]"-style suffix is set aside, or the same display name (a dated id and its undated form).
- All platforms, not win32 only: the rule is platform-neutral (a job newer than the transcript means the model was
  set after that transcript), the job-file helper already covers launchd, systemd and Task Scheduler, and a Mac agent
  whose plist is rewritten by a model change has the same stale-reading window. Rejected: a win32-only branch, which
  would leave the same window on Mac and a second rule to keep in step.
- Rejected: reading the job's model for every running agent on every poll (the server comment at plannedFor explains
  the per-poll cost). The two stats come first, so the job is read only once it is newer than the transcript: after a
  rewrite, until the next reply (on Windows that read is cached, #2717).

## Weakest premise
That a job naming a different model than the last reply means the agent runs the job's model. Two narrow cases where it
does not: a model change whose restart failed with the old process still alive (setModel's partial outcome), and a
/model switch inside Claude Code followed by a job rewrite for another reason (an account move). In both the card names
the job's model until the next reply. Before, the first was right and the second was right only by chance.
Deviation from the card's control ("a Mac agent's card still behaves as now"): the rule is platform-neutral, so a Mac or
Linux agent's card also shows the new model right after a change instead of the old one. Said on the card.

## Tests
- New engine/status.cardmodel-8601.test.js: a Claude transcript naming model A, a job file written after it naming B:
  readModel gives earlierSession with A, the snapshot's model null and earlierModelName A; control with the job older
  than the transcript gives model A as today. Plus the platform job-file helper on win32 (task file path).
- Review 1 controls: a rewrite naming the SAME model (restart, account move), no model, a short name, a [1m] suffix or a
  dated id all leave the reading; mutation (dropping the model comparison) reds four of them; against origin/main's
  status.js only the main case fails.
- Live BEFORE merge (review 1), the branch's engine reading the real agent on the Windows box: before a change, current
  Opus 4.8; 15 s after a change to Haiku 5.5, an earlier reading (card model null, so the job's Haiku 5.5 shows); after
  changing back (a restart, same model), current again. Script work/t8471live/branchread.js.
