# whatsnew-0816: the What's New list for 0.8.16

Built with `node tools/whats-new-pool.js build 0.8.16` (online) on origin/main after #8906 merged (d76e10239a), the last PR planned for the 0.8.16 staging cut (#8905 rides the next one).

## What the build did
- Read Mac prod (0.8.15, cut from f6ac36b940) and marked its four highlights shown; `lastProd` 0.8.14 -> 0.8.15.
- Picked the top five pending highlights.

## One hand edit, per the tool's header
"A just-started agent gets your first message" is Windows-only and was in 0.8.15's window, which Windows prod (0.8.15, fd2715b8aa2c) serves. The pool records Mac promotes only, so it is retired by hand: `status: shown`, `shownIn: 0.8.15`. Without that, Windows users would be told about it twice. Rebuilt after the edit.

## The list (5)
- all: The restart note says when restarts repeat (#8866; shipped in 0.8.15, never yet in a window)
- windows: Windows agents keep their account at login; Start at login stops misreading the account; A removed startup job explains its folder (shipped 0.8.06-0.8.07, never in a window)
- mac: A warning before an agent runs twice

Per platform: Windows 4, Mac 2, Linux 1.

## Checks
- `prod-check`: the pool records prod 0.8.15, rc 0.
- An offline build of the committed pool is byte-identical to `web/whats-new.json` (the cut's #7617 check).
- The five What's New test files: 60/60.

## Weakest premise
That Linux showing one line is acceptable; the build accepts it (no platform has none). Nothing higher-ranked for Linux is pending.
