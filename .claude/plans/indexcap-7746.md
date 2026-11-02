# indexcap-7746: the rest of kosmos#7746 (items 2 to 5), stacked on topplan-7746

Finished means: each of the card's items 2 to 5 is built or decided on the card, with a test that goes red without it.

## Item 2: a company's index cap
backupstate capped every index at 600,000 (the top plan), while a company's allowance is 200,000. Now backupsnapshot exports indexCapFor(planGb), the one formula its own chunkCap uses, and backuprun passes it to withRun as maxIndex (never above MAX_INDEX), at the checkpoint and after the run.
Measured: a company run reporting 200,005 rows keeps 200,000 and says leftOut 5; red when backuprun passes no cap.
Weakest premise: that the coordinator's company allowance stays 200,000. It is one constant (CHUNK_ALLOWANCE), so a change there moves both limits together.

## Item 4: a malformed backupWeeklyGb
The coordinator sends null or one of BACKUP_PLAN_GB (kosmos-relay coordinator/src/db.rs set_backup_weekly_gb refuses anything else, org.rs sends it only for a personal org). A value in any other shape fell through to undefined, the same as an older Kosmos+ that does not send it, and the run went on under the company bound with no word said.
Decided: a field that is present but not null or a positive whole number makes that run wait for the next try, with its own fixed sentence (not personActs: nothing for the person to do). An absent field behaves as before.
Measured: '25', 2.5, -1, 0, {} and true each wait without running; red with the old fallback.
Rejected: stopping until a person acts. A bad value is a version skew or a fault, and the next hourly run reads it again.

## Item 5: a checkpoint that fails is invisible
Each checkpoint write that throws is counted, and the run's answer carries `checkpointsLost` when any was lost (nothing when none). The run still never stops for one, as before: a lost checkpoint only loses what a kill would have lost.
Measured: two failing checkpoints give checkpointsLost 2; none give no field; red without the count.
Not done here: the panel showing it (personalbackup's note picks fixed sentences per flag); that is the screen's step.

## Item 3: a folder that can never finish re-walks hourly
A plan's run that stopped on the measured manifest size had uploaded chunks first. Within a week the index made the hourly repeats cheap, but each new week uploaded everything again and stopped again, spending the allowance with no snapshot.
Decided: the stop names its listing (`measuredStop: { files, bytes }`), backuprun keeps it in the state file beside the job (not per period, since the manifest limit is the same in every week and every plan), and hands it to the next run as `priorStop`. A run whose listing is at least as large in both files and bytes stops before anything is uploaded (`stoppedBefore`, with personActs and its own sentence). Smaller in either, it tries. A run that finishes forgets the stop.
Measured: the same listing stops with zero batches; one file fewer in the stop's count (smaller listing relative to it) tries; kept, handed on and forgotten through backuprun; a malformed stop in the file is dropped. Each red without its part.
Rejected: remembering it for the period only, which spends a week's allowance every week (what the card describes).
Weakest premise: that files and bytes no smaller means pieces no fewer. A person who replaces many small files with fewer large ones of the same total keeps the file count only if they add files elsewhere; the comparison needs BOTH to be no smaller, so most real tidy-ups get a fresh try.
