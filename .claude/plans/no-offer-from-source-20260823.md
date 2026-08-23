# no-offer-from-source: a board that cannot install never offers to

**2026-08-23, Josh 13:03:** "I was trying to update to 4.9 and it says there's
no update to install right now. My options are Not Now or Update and when I
hit Update nothing happens."

## What happened

The board on this Mac runs from the repo under a hand plist; its install route
refuses with "this Kosmos runs from its source code, so it updates from git".
But the status payload offered the published version anyway, so the moment
0.4.9 was on the site the toast said Install and the dialog promised a restart.
By the time he pressed it I had restarted the board onto 0.4.9 by hand, so the
route answered "there is no update to install right now". Either way the
press could never have worked on this board.

## What finished looks like

- `/api/status` carries `update: null` when there is no installed root; the
  offer is back the moment there is one. Same for `/api/update/check`, which
  also says `source: true`.
- The #338 engine-stale line is what a source-run board shows when newer code
  is on disk, and it names the command.
- Test: no offer from source with a published newer version; the offer on an
  installed root as the control; the check route the same.

## Still mine

`tools/release.sh` has no local-board restart step (#360); the deploy-then-
restart gap is what produced the exact sequence he saw.
