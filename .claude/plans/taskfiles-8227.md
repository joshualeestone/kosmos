# taskfiles-8227: kosmos task files review leftovers, Mac half (kosmos#8227)

Follow-up to #8214, whose review loop stopped at its 8-round cap. Items 2, 3 and 5 here; items 1 and 4 need a real Windows machine and went to Homer as a spec on the card.

## What
- **Item 2.** `projects.list` rows (`joinTaskClaims`'s `withParts`) leave out `builtFilePath` and `landedRepo`, as the Tasks view does. That list reaches the page and, with an agent's own token, `/api/projects/overview` and `/api/project/<id>`. Nothing in `web/` reads either field. The CLIs read both from `/api/tasks`, which builds its rows from the raw tasks and takes only claims from `joinTaskClaims`, so it keeps them (a test pins it).
- **Item 5.** `task files` with an unreadable automount table: the first task's line gives the reason in full, later ones say "the automount table again (above)". Each task keeps its own verdict line.
- **Item 3, not built:** `--strict`. No caller wants an exit code yet, and it would need a Windows half. The summary line already counts changed and missing.

## Weakest premise
- That nothing reads these fields from the project routes. Measured for `web/` (0 hits; the same search finds `landedCommit`). Not measured for an agent that reads `/api/project/<id>` and looks for a path: if one turns up, it should read `/api/tasks` instead.

## Checks
- 4 mutation arms red: paths put back, only one path stripped, the reason repeated, a path opened with no table.
