# topplan-7746: personal backup at the top of the chart (kosmos#7746)

Finished means: at the top plan (two state slots of 600,000 rows), a backup run never freezes the board for seconds at a time. Then the card's other four items, each decided on the card.

## Item 1: event-loop cost (this stage)
Measured on main (88293f57), two full slots, 243 MiB on disk: readState was one block of 1.8 to 2.1 s, writeState one block of 4.2 to 4.5 s (1.5 s of it mayReplace's full re-read of the old file), and backuprun writes before the snapshot, after it, and at each checkpoint.
Changed:
- readStateAsync and writeStateAsync give the event loop a turn every 50,000 rows and between phases. One generator per function, run straight through by the sync versions, so both give the same answers. backuprun awaits the async ones, and backupsnapshot awaits its checkpoint so two writes of one file never overlap.
- mayReplace skips its full re-read when the file is the one this process last read or wrote as ours (device, inode, size, mtime in ns; on a read, taken before and after and kept only if they agree). Any other file is checked in full, as before.
Measured after (two full slots, a 10 ms timer measuring the longest gap, the sync versions as the control that shows the timer can see a stall): writeStateAsync 1.2 to 3.2 s in total, longest stall 129 to 325 ms (JSON.stringify of the whole body, one block; the range spans a quiet and a loaded machine, the upper end a reviewer's re-measurement); readStateAsync longest stall 251 to 310 ms (JSON.parse, one block). Sync control: 1.2 to 1.7 s stalls on the same runs. Other synchronous steps left on the run path, smaller than those, measured by a reviewer: forPeriod's filter over 600,000 rows about 180 ms, withRun's index copy at a checkpoint about 50 ms.
- An async write takes turns, so writes of one file are queued: async writes run in the order asked, and a sync write while one is in flight throws. A read that does not answer ok, and discardState, forget the file's fingerprint. Tests: overlapping writes land in order (red without the queue); a file swapped in by rename with the same size and mtime to the ns is checked in full (red without dev and inode in the fingerprint).
Rejected: skipping writeState's own row check for maps already checked (it would rest "never write what would not read back" on nobody mutating a map); a streaming parser (a bigger change, only if 300 ms is not acceptable).
Weakest premise: that one process writes the file (the caller duty this module already states). A second writer that kept the same size and mtime to the nanosecond would be overwritten unchecked.
- snapshotInner's index check pauses every 50,000 entries.
Not in this stage, decided on #7746: sealManifest is one block of 2.55 s at 477,000 chunks (canonicalJson 966 ms). It moves to a worker as its own step: handed a JSON string, since handing the object costs a 464 ms synchronous copy (structuredClone).
