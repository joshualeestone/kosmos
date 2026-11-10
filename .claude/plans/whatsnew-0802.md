# whatsnew-0802: What's New for 0.8.02

Pool PR before the 0.8.02 staging cut. Data only: `release/whats-new-pool.json` and the built `web/whats-new.json`. Prod check: prod serves 0.8.00 and the pool records 0.8.00, so nothing was marked shown.

## Changes to announce, by merged PR
Everything since the first 0.8.01 pool (#8329), plus four that merged before it and were never given a line.

| PR | change | pool |
|---|---|---|
| #8315 | #8303: My Agents column on the agent page | rank 11.0, in the window |
| #8334 | #8321: the board says when two sessions run one agent | rank 11.1, in the window, mac: detection reads tmux panes (engine/status.js twinSessions), and Windows has none |
| #8331 | #8301: a parent's count says built, done and dropped apart | rank 11.3, in the window |
| #8337 | #8323: the day count is off the K mark | rank 11.85, release notes |
| #8336 | #8325: the computer control stays while a page loads | rank 11.9, release notes |
| #8319 | #8300: old room-wide asks leave --unanswered | notesOnly 89 |
| #8327 | #8307: a rebuilt task file replaces the old one | notesOnly 90 |
| #8328 | #8320: edits by more agents are named | none: which agent families it reaches differs by platform (Grok, GPT and Antigravity have no edit hook on Windows, Meta has none anywhere), and nothing an agent does depends on the note |
| #8331 | #8301: kosmos task close --not-run | notesOnly 92 |
| #8335 | #7977: kosmos agent list says why Can't tell | notesOnly 93 |
| #8342 | #8340: community counts only when changed; feedback list says whose reports | notesOnly 94 and 95 |
| #8330 | #8305: a kept model off the company list | none: a narrow refusal fixed, the row itself says what happened |
| #8338 | #8333: a log line only | none: nothing changes for anyone |
| #8341 | test sandbox fix | none: test only |
| #8326 | #4260: trust for an 8.3 or subst spelled folder on Windows | none: a Windows bug fix with nothing new to tell anyone |
| #8332, #8343 | #8283, #8221 iPhone list | none: ship with the iPhone app, not a desktop cut |

## Decided
- Window: Mac 5, Windows 3. My Agents, two copies, one step, task counts, keep account and model.
- All carry since 0.8.02 though #8315, #8334, #8331, #8337, #8336, #8319, #8327, #8328 and #8335 are already in the 0.8.01 staging build: the default kosmos whats-new shows only the newest version's notes, the same call 0.8.01 made for #8270 and #8271. Cost: dated one version late.
- The restart note, the warning before an agent runs twice, and more room between chat lines fall out of the window. They stay pending and stay in the release notes.
- Task counts rank above the restart note because a person sees them every day, and the restart note only after a restart.
- Rejected: leaving 0.8.01's five in place and adding only My Agents. The newest and most visible change would have pushed out one line and the two-copies warning would not show.

## Weakest premise
Rank is judgement. Change the number and rebuild. The Mac tag on two copies rests on reading twinSessions, not on running Windows.

## Would change my mind
A Windows run that shows "Two copies running": remove the tag.
