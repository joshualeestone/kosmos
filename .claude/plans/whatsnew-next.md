# whatsnew-next: the "Kosmos has been updated" highlights for 0.7.16

Asked by Splinter 06:10 CDT 2026-10-01: web/whats-new.json still says 0.7.11, so 0.7.14 and 0.7.15 shipped with no
window. Write the next release's highlights (everything since 0.7.11 a person will notice), checked against main.

## Change
web/whats-new.json for 0.7.16 (the next cut; 0.7.15 is already cut and on staging; production is 0.7.11), five items,
each checked on origin/main:
- Talk to your agents (the mic in the Mac app; the speaker wherever the system voice exists): #4536 e29c2c8de. The entitlement (native-app/kosmos-app.entitlements, enforced by
  tools/build-kosmos-bundle.sh) and both usage strings (install/setup.sh) are on main.
- Make a whole team at once: #4625 ddea596ac (Single / Team first screen), #4557 e65e899d1 (team in one go), #4795
  42822e251 (2 to 6). Each member is made through /api/agents, so it holds wherever making one agent does (Windows too).
- Put work on hold: #4788 ba2f2baea.
- Say what done looks like: #4722 c3db22766 (a new project asks "What does done look like?" and warns when two
  coordinators are on it). New since 0.7.11.
- One Kosmos per computer: #4822 95e96357c.

## Decided, not missed
- Five, not six: engine/whatsnew.js MAX_HIGHLIGHTS is 5, and the release check refuses more.
- Community auto-post and no pop-up are left out: Josh, #4820, "I don't want to push a big message about this."
- The phone icon fix (#4814) is left out: it is the smallest of the seven, and five is the cap.
- No Windows variant: the file has no per-platform field, and Windows reads the same file with the same version
  numbers (latest-win.json is 0.7.13). So every line is true on Windows, or names the Mac (voice). A real
  per-platform window would be its own change to engine/whatsnew.js, server.js and the checker.
- The Swarm choice is not named: it shows only when the board can run swarms.

## Weakest premise
That voice works in the signed 0.7.16 build. It is merged with everything it needs, but nobody has heard it working in
a served build yet (#4409). If that cut's voice check fails, drop the first item before the cut.

## Tests
- node tools/whats-new-check.js 0.7.16: rc 0. CONTROL: 0.7.15 gives rc 3.
- tools.whats-new-check-3955.test.js 6/6; server.test.js whats-new tests 2/2 (name filter, count asserted).

## Review rounds
- Round 1 (sonnet): FIXED W: room posts swapped out (the gain shows only in big rooms, 6.1 s to 0.8 s for 20 members,
  under a second at normal sizes, and Windows delivers through another path) for #4722, which shows on every new project.
  FIXED W: "any message box" overclaimed; the mic is in chats, rooms and the Guide, so "a chat or a room". FIXED NITs: no
  team size (the live catalogue's teams are 3 to 6 today); a paused project is resumed, not taken off hold.
- Round 2 (opus): FIXED W: "On a Mac" covered both sentences, but only the mic needs the Mac app; the speaker is drawn
  wherever speechSynthesis exists (html.has-speak), Windows included, so the Mac qualifier now covers only the mic, as
  "in the Mac app" (a browser on a Mac has no mic). FIXED NIT: the coordinator warning appears after the second one
  joins ("Two coordinators on this project."), so "are both coordinators". Left NITs: the swarm icon on the team line;
  the org-chart upload (#4559) not named; "This computer" before a Kosmos+ sign-in.
