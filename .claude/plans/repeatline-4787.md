# repeatline-4787: doctrine v25, work that comes back on a schedule (kosmos#4787 slice 1b)

Slice 1 (#5389) gave agents `kosmos task repeat` and `kosmos task ran`; nothing yet tells them when to use it. This adds one paragraph to the working rules every agent gets, under `### Put the work on a task first`: a job on a schedule is one task that repeats, set with the exact command; Kosmos shows when a run is due and does not start it; after each run, `task ran` with how the checks went; never marked built.

Measured before merge with claude -p on throwaway agents (a stand-in kosmos logging calls, never a board), against the v24 block as control; the numbers and the weakest premise are in the version log in engine/defaults.js.

engine/doctrine-past.js is regenerated, with main's two v21 rows and one section merged back by sha256: the generator walks only this branch's history and cannot produce them (the same happens on main; a generator fix is separate).
