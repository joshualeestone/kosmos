# Personal backup slice D3a: the run that restores a person's files (#7404)

Stacked on pbproof-7404 (D1), and needs pbread-7404 (D2) on the box and in the connector before it can work.

engine/personalrestore.js: listBackups() and restoreFiles({ key }). A new world, a private sink, read grants from
mine/read in batches of 400 (the connector's 64 KiB body), runRestore under `trust: 'member-proof'`, then the files moved
into the world. The member keys come from personalRestoreKeys, only for a restore; the job never holds one.

restorefetch takes a grantKeys limit. A company fetcher is unchanged.

The manifest is fetched and proved before a world is made, so a refusal, an outage or a failed proof spends no restored
name; that costs one extra grant out of 600 an hour, which is why the two fetchers are not shared. A run that still fails
with nothing landed hides its world; one with files keeps the world and the sink's record.

Measured, not assumed: a manifest names only chunks of its own week. backupsnapshot keyProblem stops a run on any other
period and backupstate files its index per period, so the route's stricter contract is the real one.

Not here, on follow-ups before the switch: the guard against two restores at once moving with the run into its child
process (it holds per process today); measuring a 400-key answer through the connector against D2; a screen and its routes (a design review), which a person starts it from, and
which must run it off the board's event loop;
carrying on a restore that stopped part way (the sink keeps its record for it); and the disk budget's messages. Nothing
calls this module yet.
