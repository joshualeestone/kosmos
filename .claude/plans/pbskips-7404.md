# pbskips-7404: a personal backup keeps what it left out, for the panel to name (kosmos#7404)

The plan screen says "After each backup you can see exactly what was left out". Today nothing keeps that list.

- `takeSnapshot`'s good answer adds `skippedList`, the first 200 skips; `skipped` stays the whole count.
- `noteRun` keeps `skippedFiles { count, files }` from a good run, and a failed run keeps the last one.
- `report()` answers `skippedFiles` on the plain good state only.

The panel's display is a separate web change with a design review. The note holds paths, masked by the walk, stored
unencrypted at mode 600, and reaches only the `isViaScreen` route, which may be a remote browser on the owner's own screen.

Rejected: showing the list while a stop is up (the stop is what the person needs then).
Weakest premise: 200 is a guess at what a person reads; the count says the rest.
