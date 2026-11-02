# pbleftout-7404

The personal backup panel names what the last good backup left out (kosmos#7404). The engine already keeps it
(`report().skippedFiles`, #7774); this shows it: a collapsed list under "Last backed up", the count in its summary,
each path with its reason, and how many more are not named past 200. It is shown only beside a plain on view.

Also the Turn off confirm now says what happens to what is already backed up, true once the relay purge
(kosmos-relay #754) is on: kept at least 30 days, then deleted. Personal backup does not switch on before that purge.

Not here: Settings words for the plan screen (they wait on the plans list, #7685), and the restore screen.
