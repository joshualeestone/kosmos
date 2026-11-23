# whatsnew-0818: the What's New list for 0.8.18

Built with `node tools/whats-new-pool.js build 0.8.18` (online) on origin/main at 92da620ecc, which carries #8936 (#8928 slice 2), #8941 (#8935) and #8942 (#8938 items 1 to 3).

## What the build did
- Both prods serve 0.8.17 and the pool already recorded both (#8924 did it), so nothing new was marked shown.
- Picked the top five pending highlights.

## Pool additions (since 0.8.18)
- **A company computer says whose it is** (#8942, all platforms, rank 12.8): a company member's Kosmos names the company, lists what it reports and never sends, and says which AI providers are allowed. Ranked into the five: it is the main user-facing change since 0.8.17.
- **Agent browsers left running are closed** (#8936, mac, rank 17.3): kept just outside the five, so Linux keeps three lines. Mac only because Windows ships it off until measured (#8928, needs-device).
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
That the company line is true on every platform: #8942 is web/index.html only, which every platform serves; I read the PR summary and Renet's review, not a walk on Windows.
