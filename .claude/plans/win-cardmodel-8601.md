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
- Review 1: NOT the file time alone. An account move or provider switch rewrites the job on every platform, and on
  Windows /Change /DISABLE and /ENABLE (a stop and start, a world switch, a removal) move the task file's time, all with
  the model unchanged. Time alone blanked the model, the context ring (limitFor(null)) and whoami's answer then. So the
  job must also NAME a different model. (Review 3, measured: a plain Kosmos restart, POST /restart, does NOT move the
  task file's time; the review 1 note that it did was wrong. The Codex rule stays on time alone, on purpose.)
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

- Review 4: the reading's age is the TIMESTAMP of the reply that named the model (readBeforeJob / modelRowAt), not the
  transcript file's time. Claude Code writes the person's prompt row as soon as it is sent, so with the file's time the
  first message after a change made the transcript newer than the job and the old model read as current again until
  the first reply. No readable timestamp in the tail: the file's time, as before. The Codex rule keeps the file time.

- Review 6: the age is the NEWEST reply on any real model (newestReplyAt; a `<synthetic>` row does not count), not the
  row naming the model read. modelInText prefers an id the name table knows over a newer one it does not, so after a
  change to a model not in the table yet, timing the old model's row kept the reading "earlier" through every reply on
  the new model (model null for the ring and whoami for many turns). Any reply after the job ends the window. The job
  file is stat'd before the tail is scanned, so an agent with no job (fleet, untied) pays one stat.
- Accepted (review 6): while a reading is earlier, the job is read twice per poll for that agent (jobNamesAnotherModel
  here, plannedFor in server.js; cached on Windows, a small file read on Mac and Linux), until the next reply.

## Weakest premise
That a job naming a different model than the last reply means the agent runs the job's model. Two narrow cases where it
does not: a model change whose restart failed with the old process still alive (setModel's partial outcome), and a
/model switch inside Claude Code followed by a job rewrite for another reason (an account move). In both the card names
the job's model until the next reply. Before, the first was right and the second was right only by chance.
Review 2: a transcript that names the SAME model in another spelling (a bare "opus" row, a provider-shaped id such as
us.anthropic.claude-..., a "@date" suffix) reads as "another model" against the job's full id. After a rewrite and before
the next reply the card then shows the job's model (the same model, so what the person sees is right), but `model` is
null for the context ring and whoami until that reply. Bounded by the next reply; accepted. On Windows a stop and start also moves
the task file's time, so for such an agent this repeats after every stop and start, not only after a model change.
Review 3: a narrow window where the card still names the old model: the agent is mid-reply when the change rewrites the
job, and the old process appends a row before the restart stops it. The transcript is then newer than the job and the
old model reads as current until the next reply. The original symptom in a small window, not a regression.
Review 3 said an unknown dated id against its undated form reads as "another model" (accepted). Review 5 reversed
that: a snapshot date ("-YYYYMMDD" or "@YYYYMMDD") is set aside before comparing, so a model the name table does not
know yet matches its own dated form and a routine rewrite does not hide its reading; the test is now a control.
Review 2: like the Codex rule it shares writtenBeforeJob with, this reads the job in this process's own world only
(no worldId), so an agent of a named world (#1704) keeps today's behaviour. Not new; noted.
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
- Review 2: engine/status.cardmodel-realjob-8601.test.js writes the job the way this platform keeps it (plist, systemd
  unit, or the stand-in Task Scheduler on Windows) with setModel's full id and reads it through the real
  create.plannedModelOf; the main case fails against origin/main's status.js. The server hop (modelName null on a running
  card fills plannedModelName from the job) is pinned by server.test.js "a tied card reports the model its job will start
  it on, and only when no live model was read".
- Review 4, live with the branch engine on the Windows box (work/t8471live/prompt8601c.ps1, a fresh process per read,
  since win32job remembers a task it has read until its own install, and only the board's own setModel refreshes
  that): job naming Opus 4.8, last reply Haiku 5.5. Before the prompt: earlier (the card shows the planned Opus). Prompt
  sent 23:54:09.154, user row written 09.72: the two reads after it are still earlier (the file time alone would have
  read Haiku as current). Opus reply 10.661: current Opus. The card never named the wrong model.
