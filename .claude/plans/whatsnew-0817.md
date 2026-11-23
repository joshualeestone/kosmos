# whatsnew-0817: the What's New list for 0.8.17

Built with `node tools/whats-new-pool.js build 0.8.17` (online) on origin/main at a43cb80fb4, which carries #8913 (#8905), #8918 (#8917), #8914 and #8915 (#8912), #8920 (#8919) and #8921 (#8916).

## What the build did
- Read Mac prod (0.8.16, frozen at bcf56809947a) and marked its three Mac-visible highlights shown; `lastProd` 0.8.15 -> 0.8.16.
- Picked the top five pending highlights.

## Hand edits
- **Two Windows-only lines retired by hand**, `status: shown`, `shownIn: 0.8.16`: "Windows agents keep their account at login" and "Start at login stops misreading the account". Both were in 0.8.16's window, which Windows prod serves (latest-win.json 0.8.16). The pool records Mac promotes only, so without this Windows users would see them twice. (Splinter asked for a card so this stops being by hand; filed after the cut.)
- **Two notes-only lines** (in `kosmos whats-new`, never in the window), since both changes are agent-facing CLI output (Mona Lisa's read, 22:03):
  - "kosmos project show counts by task list groups" (#8917, both CLIs)
  - "kosmos community stops on a silent pipe" (#8905). Untagged: the tool allows only mac or windows tags, and a mac tag would hide it from Linux, which shares this CLI. The line names no platform, so it stays true on Windows, where these verbs already stopped.

## The list (5)
- windows: A removed startup job explains its folder (since 0.8.07)
- mac: A warning before an agent runs twice (since 0.8.01)
- all: The Guide says how to free its name (since 0.8.06)
- all: A stalled repeat shows one row (since 0.8.07)
- all: Memory rings stay thin and whole (since 0.8.08)

Per platform: Windows 4, Mac 4, Linux 3.

## Mona Lisa's copy read (22:05), taken
- "A warning before an agent runs twice": the line no longer says "another login job" (our word); it says something else on this computer also starts it at login.
- The typed-message line is retitled "A message to an agent is not lost to typing" (her suggestion, shortened to the 48-character title limit) and reworded. For balance it swaps ranks with "The Guide says how to free its name" (11.9 and 12.7), so it waits for the next window and Linux sees 3 lines instead of 2.
- None of the three was ever in a window (git log -S over web/whats-new.json).

"A warning before an agent runs twice" was in the 0.8.01 and 0.8.03 windows. Neither reached prod on the Mac (Mac prod went 0.8.00, 0.8.02, 0.8.06); 0.8.03 reached prod only on Windows, where its mac tag hides it. The pool's `shownIn: 0.8.03` entries are exactly that window's two Windows-only lines, retired by hand then. So no prod user has seen it.

## Checks
- `prod-check`: the pool records prod 0.8.16, rc 0.
- An offline build of the committed pool is byte-identical to `web/whats-new.json` (the cut's #7617 check).

## Weakest premise
That the Guide line is a better use of the shared slot now than the typed-message fix. It is a ranking, reversible in the pool.
