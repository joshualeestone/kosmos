# planbound-7404: a personal backup sizes itself to the person's plan (kosmos#7404)

Josh's chart, final 11-01 09:22, 25 to 500 GB of files. The coordinator half is relay tierallow-7404.

- `personalbackup.runJob` reads `backupWeeklyGb` from the full org status once a run. Null: no run, a sentence, no pause
  to Monday. Absent or unread: the run goes ahead as today, and Kosmos+ still refuses what the plan does not cover.
- `takeSnapshot` takes `deps.planGb`. With it, listed file bytes are compared with the plan in plain words, the
  worst-case chunk and byte bounds are replaced by an expected count (1 MiB average plus a quarter, keys at 140), and the
  running manifest size becomes the real check. Without it, a company's path does not change.
- The manifest ceiling: 192 MiB for a plan's run, 256 MiB on restore. A company's budget stays at 64 MiB's.

Measured on generated manifests with real name and key lengths: 286 bytes a chunk; 477,000 chunks is 130 MiB of JSON and
about 1 GB resident while parsing, generation included.

Depends on: the coordinator's `MAX_MANIFEST_OBJECT` rising to 192 MiB, a separate relay change after tierallow-7404. Until
then a manifest past 64 MiB is refused by Kosmos+, which only a folder near 200 GB can reach.

Rejected: several manifests per snapshot (a format change on restore); a planning pass (reads everything twice); keeping
the worst-case bound (needs a manifest ten times too big).
Weakest premise: the 1 MiB average on a real folder. An unusual folder can pass the check, upload, and only then stop on
the measured size; what went up stays in the index and is reused. Also: restore now holds up to about 1 GB of manifest,
which is one more reason the restore screen must run it off the board's event loop.

Round 1 changes: a plan's limits stay out of the listing's fit check, so an optional folder is never dropped to fit and
read as a good backup. The small-files check counts chunks at the average with no slack and no index, because a second
run's files ARE its index; real spend is the coordinator's to refuse. The chunk index cap is 600,000, the top plan's.
A status read that fails waits the hour rather than run under the company bound and pause to Monday.
Merge this after the coordinator's ceiling rises, or a folder near 200 GB uploads every chunk and fails at the manifest.

Round 2: the measured-size stop has its own sentence and ends the run for the week, so it does not walk every hour.
Open, for the restore screen and before the switch: the manifest GET has 78 s, about 1.7 MB/s for a 130 MiB manifest, so
the largest plans on a slow link need a longer one (`manifestTimeoutMs` exists). Kept: the 600,000 index cap applies to a
company too, whose allowance stops it at 200,000 anyway.
