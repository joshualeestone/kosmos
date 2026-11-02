# pbskips-7404: a personal backup keeps what it left out, for the panel to name (kosmos#7404)

The plan screen says "After each backup you can see exactly what was left out". Today nothing keeps that list.

- `takeSnapshot`'s good answer adds `skippedList`, the first 200 skips; `skipped` stays the whole count.
- `noteRun` keeps `leftOut { count, files }` from a good run, and a failed run keeps the last one.
- `report()` answers `leftOut` on the plain good state only.

The panel's display is a separate web change with a design review. The note is mode 600 on this computer and holds paths,
as the manifest does; nothing here leaves the computer.

Rejected: showing the list while a stop is up (the stop is what the person needs then).
Weakest premise: 200 is a guess at what a person reads; the count says the rest.
