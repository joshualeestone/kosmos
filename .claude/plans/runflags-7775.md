# runflags-7775: the personal backup panel says what the last run did

Card: kosmos#7775. Follow-up from #7746 and #7753.

## Finished means
The personal backup panel's plain line says, in a fixed sentence, when the last run lost checkpoints or sealed the manifest in-process, and says nothing when the run did neither. No run's own text reaches the panel.

## Done
- engine/personalbackup.js: noteRun keeps booleans from the run's answer (from a positive whole checkpointsLost: troubleSaving on a finished run, lostCheckpoints on a failed one; sealedHere from one of the four known sealedInProcess reasons). reportNow appends a fixed sentence for each after the wait or first-try line. A stop outranks them (note stays null with a stop), and the not-running and company-pause branches do not show them.
- No web/ change: web/index.html pbJobLines already shows job.note in the plain line.
- Tests: engine/personalbackupjob-7404.test.js (the #7775 tests), engine/backuprun.test.js (sealedInProcess rides runBackup's answer). Red controls run for each guard.

## Decided
- unsignedBecause is not shown. A personal key is never signed (personalKeyForJob never reaches backupmemberkey.register), so on a personal run it is always absent; it rides company runs, and no company panel exists. Not carried through backupjob.fromAnswer either: nothing would read it. Written on the card.
- Lines are plain, not the error colour: neither flag stops a backup.
- A failed try's lost checkpoints are that try's ("On the last try"): every run writes the note, so a run without them clears the line. The in-process seal and the finished run's trouble-saving line are the last finished backup's: only a finished run sets them, a failed try keeps them, and the next finished backup replaces them (reviews 2 and 4).
- Validation: targeted suites each round; the full validation helper once at convergence.
