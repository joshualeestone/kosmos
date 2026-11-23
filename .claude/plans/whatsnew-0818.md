# whatsnew-0818: the What's New list for 0.8.18

Built with `node tools/whats-new-pool.js build 0.8.18` (online) on origin/main at 92da620ecc, which carries #8936 (#8928 slice 2), #8941 (#8935) and #8942 (#8938 items 1 to 3).

## What the build did
- Both prods serve 0.8.17 and the pool already recorded both (#8924 did it), so nothing new was marked shown.
- Picked the top five pending highlights.

## Pool additions (since 0.8.18)
- **A company computer says whose it is** (#8942, all platforms, rank 12.8): "A company member's Kosmos names its company and what it reports there, and which AI providers the company allows, if it limits them." Not "and never sends": a computer that joined before #8942 keeps no never lines (Renet Tilley, m6199), and today that is every member. The provider clause is conditional because server.js sends allowedProviderNames only when a providers_allowed list is in force (review round 2). Started from Mona Lisa's copy read (m6200); the condition is mine. Ranked into the five: it is the main user-facing change since 0.8.17.
- **Agent browsers left running are closed** (#8936, mac, rank 17.3): "From now on, a browser an agent's session leaves running is closed when that agent starts again, so they stop piling up." "From now on" because a server left by 0.8.17 used the shared output folder, which the per-agent match (slice 1) never selects, and the sweep is skipped on an agent's first launch with its own folder (review round 2). Kept just outside the five, so Linux keeps three lines. Mac only: engine/agent-browser-config.js runs it live only when `process.platform === 'darwin'`, and the Windows supervisor passes endOrphans on no real start (#8928, needs-device).
- **A command points to its longer guide** (#8941, notesOnly): agent-facing CLI output, so notes only, like 0.8.17's CLI lines.

## The list (5)
- windows: Browsers Kosmos opens keep its keys out
- mac: A message to an agent is not lost to typing
- all: A company computer says whose it is
- all: A little more space in project rooms
- all: Long agent messages say what they are about

Per platform: Windows 4, Mac 4, Linux 3.

## Checks
- `prod-check`: rc 0, the pool records prod 0.8.17 on both families.
- An offline build of the committed pool is byte-identical to `web/whats-new.json` (the cut's #7617 check).

## Rejected
- Ranking the browser clean-up into the five: it would push out an all-platform line and leave Linux two.

## Weakest premise
That "names ... what it reports there" holds for a member whose Kosmos is not reporting yet (waiting for a print or on terms): the new Reported: line is absent then, and I rely on the older Settings sentences that already say it reports nothing or is waiting. The platform is not the risk: orgenroll.js and the web/index.html change have no platform gate.
