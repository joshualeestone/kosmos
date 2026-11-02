# indexcap-7746: the rest of kosmos#7746 (items 2 to 5), stacked on topplan-7746

Finished means: each of the card's items 2 to 5 is built or decided on the card, with a test that goes red without it.

## Item 2: a company's index cap
backupstate capped every index at 600,000 (the top plan), while a company's allowance is 200,000. Now backupsnapshot exports indexCapFor(planGb), the one formula its own chunkCap uses, and backuprun passes it to withRun as maxIndex (never above MAX_INDEX), at the checkpoint and after the run.
Measured: a company run reporting 200,005 rows keeps 200,000 and says leftOut 5; red when backuprun passes no cap.
Weakest premise: that the coordinator's company allowance stays 200,000. It is one constant (CHUNK_ALLOWANCE), so a change there moves both limits together.

## Item 4: a malformed backupWeeklyGb
The coordinator sends null or one of BACKUP_PLAN_GB (kosmos-relay coordinator/src/db.rs set_backup_weekly_gb refuses anything else, org.rs sends it only for a personal org). A value in any other shape fell through to undefined, the same as an older Kosmos+ that does not send it, and the run went on under the company bound with no word said.
Decided: a field that is present but not null or a positive whole number makes that run wait for the next try, with its own fixed sentence. It carries `planUnreadable`, which the panel turns into its own sentence ("Updating Kosmos may fix it"): version skew is persistent, so the person is told rather than seeing an ageing last backup. An absent field behaves as before.
Measured: '25', 2.5, -1, 0, {} and true each wait without running; red with the old fallback.
Rejected: stopping until a person acts. A bad value is a version skew or a fault, and the next hourly run reads it again.

## Item 5: a checkpoint that fails is invisible
Each checkpoint write that throws is counted, and the run's answer carries `checkpointsLost` when any was lost (nothing when none). The run still never stops for one, as before: a lost checkpoint only loses what a kill would have lost.
Measured: two failing checkpoints give checkpointsLost 2; none give no field; red without the count.
Not done here: the panel showing it (personalbackup's note picks fixed sentences per flag); that is the screen's step.

## Item 3: a folder that can never finish re-walks hourly
A plan's run that stopped on the measured manifest size had uploaded chunks first. Within a week the index made the hourly repeats cheap, but each new week uploaded everything again and stopped again, spending the allowance with no snapshot.
Decided: the stop names its listing and what it was measured under (`measuredStop: { files, bytes, budget, at }`), backuprun keeps it in the state file beside the job (not per period, since the manifest limit is the same in every week and every plan), and hands it to the next run as `priorStop`. A run whose listing is at least as large in both files and bytes, under the same manifest budget, stops before anything is uploaded (`stoppedBefore`, with personActs and its own sentence). Smaller in either, or another budget, it tries. A run that finishes forgets the stop. An early stop measured nothing, so it names no stop and the kept one stays as it was (it never climbs to a larger listing); a stop measured on a smaller listing replaces it, since it follows the latest measurement. The stop also records which folders it was measured on (a 16-hex hash of their sorted paths), so another set of folders of the same size is tried. A stop dated after now (a clock that was ahead) counts as expired. A kept stop older than 28 days is not handed on, so one real attempt measures again. Stated plainly, both ways: a right stop costs one spent attempt in 28 days instead of one a week; a WRONG stop (the estimate counts keys not yet granted at a fixed length, and skips and redactions vary between runs) holds every run for up to 28 days, with the person told to move files out. Rejected: a shorter window, which re-spends the allowance about as often as before this change. The early stop runs after the plan's own checks, so a person over their plan is told that, not this.
Measured: the same listing stops with zero batches and names no stop; a stop with more files than the listing lets it try; another budget lets it try; kept, unchanged by an early stop, handed on and forgotten through backuprun; a stop past 28 days is not handed on; a malformed stop in the file is dropped. Each red without its part.
Rejected: remembering it for the period only, which spends a week's allowance every week (what the card describes).
Weakest premise: that files and bytes no smaller means pieces no fewer. A person who replaces many small files with fewer large ones of the same total keeps the file count only if they add files elsewhere; the comparison needs BOTH to be no smaller, so most real tidy-ups get a fresh try.
