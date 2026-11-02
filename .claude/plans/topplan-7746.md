# topplan-7746: personal backup at the top of the chart (kosmos#7746)

Finished means: at the top plan (two state slots of 600,000 rows), a backup run never freezes the board for seconds at a time. Then the card's other four items, each decided on the card.

## Item 1: event-loop cost (this stage)
Measured on main (88293f57), two full slots, 243 MiB on disk: readState was one block of 1.8 to 2.1 s, writeState one block of 4.2 to 4.5 s (1.5 s of it mayReplace's full re-read of the old file), and backuprun writes before the snapshot, after it, and at each checkpoint.
Changed:
- readStateAsync and writeStateAsync give the event loop a turn every 50,000 rows and between phases. One generator per function, run straight through by the sync versions, so both give the same answers. backuprun awaits the async ones, and backupsnapshot awaits its checkpoint so two writes of one file never overlap.
- mayReplace skips its full re-read when the file is the one this process last read or wrote as ours (device, inode, size, mtime in ns; on a read, taken before and after and kept only if they agree). Any other file is checked in full, as before.
Measured after (same machine, same data, a 10 ms timer measuring the longest gap, the sync versions as the control that shows the timer can see a stall): writeStateAsync 1.2 to 1.4 s in total with a longest stall of 129 to 139 ms; readStateAsync a longest stall of 253 to 310 ms (JSON.parse of the file, not chunked). Sync control: 1.2 to 1.7 s stalls.
Rejected: skipping writeState's own row check for maps already checked (it would rest "never write what would not read back" on nobody mutating a map); a streaming parser (a bigger change, only if 300 ms is not acceptable).
Weakest premise: that one process writes the file (the caller duty this module already states). A second writer that kept the same size and mtime to the nanosecond would be overwritten unchecked.
- snapshotInner's index check pauses every 50,000 entries.
Not in this stage, decided on #7746: sealManifest is one block of 2.55 s at 477,000 chunks (canonicalJson 966 ms). It moves to a worker as its own step: handed a JSON string, since handing the object costs a 464 ms synchronous copy (structuredClone).
