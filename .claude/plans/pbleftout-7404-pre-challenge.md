---
pre_challenge: true
method: challenge-loop
branch: pbleftout-7404
diff_hash: f093b5d3aeed0efd4a41fd94a246040cfd6822f458e09b3752dd7ec18ef10db8
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T12:33:57Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3, blind, sonnet, opus, sonnet. There were also two design review rounds by Mona Lisa, now approved.
**Converged:** Yes. Iteration 3 raised no BLOCKER, and its two WARNINGs were fixed.
**Total findings:** 1 BLOCKER, 12 WARNINGs, NITs.

Validation: full `validation_log_run_or_skip` on Mortals at ccf0ed47ab, hash f093b5d3aeed, passed.

Every new guard was mutated and its test went red:
- the lifted pbSkippedShow (9 fail)
- a map rule (2 fail)
- the repaint check and the close on hide (1 each)
- the extraction regex (its per-file floor fired)

### Iteration 1

- [BLOCKER] web.pbcode-7404.test.js runs pbPaint in a vm and did not lift the new functions, so every one of its tests would throw. Fixed: it lifts PB_WHY, PB_WHY_OPENING and the three functions, and its fake DOM has the new ids.
- [WARNING] The reason map missed Kosmos store reasons, undo copies and the backup settings. Fixed, and the test now reads every reason out of the engine.
- [WARNING] `/link/` called a vanished file a shortcut. Fixed.
- [WARNING] `/restore/` called any name problem a clash. Fixed: split into clash and cannot-be-restored.
- [WARNING] The Turn off sentence was unpinned. Fixed: a test pins it.
- [NIT] The list was 200 rows tall with no scroll; fixed. The summary was low contrast; now label-2. The count said "files" for folders too; now "files and folders".

### Iteration 2

- [WARNING] A word inside a person's own path ("secret", "archive") could pick the phrase. Fixed: a reason's fixed opening decides first (PB_WHY_OPENING).
- [WARNING] The extraction missed backupsessions.js, backupagy.js, `leave(` arguments, ternaries and commented rows. Fixed. Dead allowlist entries now fail the test.
- [WARNING] Sockets and mounted disks were called links. Fixed: each has its own words.
- [WARNING] A .git folder read as "may hold a password or key". Fixed: the Git rule comes first.
- [WARNING] The Turn off words depend on relay #754. Recorded on the card. #754 has since merged.
- [NIT] The display path was untested. Fixed: a vm test paints through the real pbPaint.

### Iteration 3

- No BLOCKER.
- [WARNING] Overlapping folders claimed "already backed up from another folder", but both can be left out. Fixed: "it overlaps another folder".
- [WARNING] One file read as nothing could still pass. Fixed: a per-file floor and one known reason per file.

### Design review (Mona Lisa)

- [WARNING] Engineer-speak reasons. Fixed: a fixed plain-word map with a fallback.
- [NIT] The "more" line read as Turn off's caption. Fixed: a 20px gap.
- [NIT] Masking reasons said "may hold a password or key". Fixed: now "Kosmos could not check it".
