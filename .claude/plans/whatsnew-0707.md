# whatsnew-0707: the What's New window for the next Mac build (the prod candidate)

## Why
Splinter, 2026-09-28 12:14: the release lane owns the What's New highlights. 0.7.06 went to staging with no window (web/whats-new.json was still 0.7.05's, and release.sh step 1b-ii refuses a mismatched version). The next cut, the build with Angel's Muse switch, is the prod candidate, so its window has to cover everything since 0.7.05, in Josh's plain voice, 4 to 5 tiles, merged before that cut's freeze so it does not hold it.

## Call
- `web/whats-new.json` for version 0.7.07 (the next free number after 0.7.06; if Windows takes 0.7.07 first, this is a one-field change to the next free number, which release.sh step 1b-ii will name).
- Five tiles, each from a change merged since 0.7.05 that a person will notice: a Project Manager makes the agents the work needs (#1279); Reply in Direct Messages and the unread outline (#4256, #3743); one reminder for a new agent that has not answered (#3226); the Kosmos Community switch and its one-time notice (#4288); "Kosmos+ member" in the user menu (#3360) with the Mac's remote-access status report (#4277).
- Left out on purpose: Meta Muse (behind a flag, so not something a person sees yet); test and CI work; small fixes a person would not notice in a tile. The versions.html entry carries the longer list.
- Limits from engine/whatsnew.js: at most 5 highlights, title <= 48 characters, line <= 140, icons from the app's set.

## Weakest premise
That the Muse switch stays invisible to ordinary users in the next build. If Angel's switch makes Muse selectable by default, a Muse tile should replace the weakest tile here (probably the Kosmos+ one).

## Evidence
- `node tools/whats-new-check.js 0.7.07`: 5 highlight(s) for 0.7.07.
