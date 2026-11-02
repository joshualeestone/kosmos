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
