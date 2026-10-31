# pbjob-7404: personal backup's job (uploads), built dark

Card: joshualeestone/kosmos#7404. Follows #7683 (screens and routes). Nothing here turns anything on: the coordinator's
KOSMOS_PERSONAL_BACKUP and the price stay Josh's (#7685).

## What was measured (origin/main afd4e66cd7, relay b63ae376d)
- backuprun.runBackup takes deps.ensureMemberKey, so the run itself can be reused. The default one calls the company
  backup-key route, which refuses a personal org for good (backup.rs Personal::Refuse). Personal needs its own key step.
- Grant and manifest already allow a personal org with a registered key (Personal::Upload). They do NOT check that the
  member accepted the current words. Rollups do (org_enrollment_binds.consent_hash, db.rs), so the shape exists.
- personal_consent backsUp is []. Test the_personal_words_name_no_report_and_nothing_backed_up requires readers to be
  rewritten in the same change.
- Objects sit under a COMPLIANCE lock 30 to 38 days past their period (backup.rs), which nobody can delete early. The
  words must say so. This is why a family is refused.
- startTick's sentences say "company backup". The agy stage folder is one path; two ticks would clear each other's.
- A restore of FILES has no personal path: content.rs refuses a personal org and #7118's route is the company's.

## Slices
A. RELAY: the words, and the upload gate. personal_consent names what goes up, who can read it and the lock; Personal::Upload
   refuses (org_consent_changed) unless the bound consent hash is the current words' hash. Deploys first.
B. ENGINE (this branch), in personalbackup.js, personalbackupkey.js and backuptick.js:
   - key step: reads /v1/org/backup/member-key/mine, answers the newest registered key from the local file only when
     Kosmos+ lists that same key for that epoch and the org is the personal record's org. Never registers, never makes a
     new epoch (personalbackupkey.js: a new epoch needs re-wrapping to the code).
   - gate: board offer shown AND state() 'on' AND mayReport under the personal root AND the accepted words name something
     backed up AND no company enrollment file at store.ROOT (holdsEnrollment). So words that say nothing goes up can never
     upload.
   - a second startTick with its own say prefix and stage folder; backuprun's chain keeps runs one at a time.
C. Panel: "last backed up" and a failure a person can see; the on-view words; and a state for "the words changed" and for
   "the key is gone", and for on-but-mayBackUp-false (words kept with no backsUp, or not kept at all, where no run happens
   and nothing is said, not even in the log), each with its own way forward. Also every other reason a run stops for good:
   refusedState (nothing calls discardState, and off then on does not clear the file), unreadableKeyFile, a different key
   here, missing, and a lostEpoch at the newest epoch. state() still reads 'on' for all of them, and today's only way out is off then
   on, which the log says and the panel does not. Design review. The tick's say reaches only the log, so a paying person
   cannot see a backup that stopped. Must land before the switch.
D. Restore of files: a personal route for manifests and chunks, then the restore screen. Must land before the switch. The
   line before Restore changes then.

## Decisions
- Second tick instance, not one tick choosing per run. Rejected: one tick, because its pause state (a day on backup_off)
  would carry across a company join. Weakest premise: company and personal are never both true. The gate refuses while a
  company file is here; the relay already refuses a personal org to an account in a company.
- Reuse store.ROOT/backupstate and backupkeys, per (org, member), with its own pointer (current-personal.json). Rejected:
  a separate root, because backupstate and backupmemberkey read store.ROOT and the files are keyed by pair. Rejected: the
  shared current.json (challenge round 3 measured a company's left-over lostEpoch or bad state file stopping every personal
  run for good). Weakest premise: a personal pair's own bad state file is said once and stays until someone sets it aside.
- Known, left for slice C: Antigravity staging runs before the key step, so a run stopped at the key still copies those
  files each hour. Some backuprun sentences say company under the personal label.
- Off and on needs a price: server.js refuses preview and on with no_price but not off. #7685 moves the price to Kosmos+.
- Words (Josh may swap them, the carve-out parks the sentence, not the slice):
  backsUp: your agents' folders and the files in them / your project folders / your conversations with your agents /
           each backup stays stored for at least 30 days, even after you turn this off, and cannot be deleted sooner
  readers: you, with your recovery code. Kosmos cannot read your backup
  Weakest premise: what happens to objects after the lock (bucket lifecycle) is not measured here; check before D.

## What would change this
A second computer uploading under one member, a new-epoch path, or Josh choosing a recoverable key over end to end.
