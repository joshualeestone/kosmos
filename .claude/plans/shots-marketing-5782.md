# shots-marketing-5782: a marketing data set for mobile-shots (#5782)

**Finished means:** `mobile-shots.js --data marketing --faces DIR` shoots the org chart, an agent's messages and a project page from the real app with demo people who have faces, a team shape and honest task reports, at 2x for composites; the sample and store sets are unchanged except the project-room pointer.

## Steps
- [x] `marketing` set: store fleet, Cleo leads (reportsTo by profile key), Farah shown as Farid, person "Sam Rivera", tasks spread across the team with commitments reports.
- [x] `--faces DIR` through store.saveAvatar / you.savePicture; must be a folder; jpg, png, webp, gif.
- [x] `desktop2x` size, always saved at 2x.
- [x] project-room parks the pointer (its hover bar was in every shot, store set too).
- [x] Reports re-stamped before a screen that shows tasks (stale after 30 min).
- [x] Shoots run on the box: 8 shots, 0 overflow, 0 errors (15:35); composites posted for Josh.
- [x] Blind review: 0 blockers; 2 warnings and 4 nits fixed.
- [ ] Verification shoot on the fixed head, then PR.

## Decided
- Faces come from a folder, never the repo, and the header says they must never be a real person's photo (the leak guard reads text only).
- The bookkeeper shows as Farid because the four published faces are two women and two men.
