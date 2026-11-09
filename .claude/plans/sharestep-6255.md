# sharestep-6255 (kosmos#6255): the board and phone share step, dark

## Done when
With KOSMOS_SHARE_STEP=1, and POST /v1/mac/account-invite answering ok: a person whose first agent has done something sees "Help Kosmos grow" once per board, on whichever comes first: the computer (Copy your invite link, Not now) or the phone (the system share sheet, Not now). "A month free" appears only when the service answers reward: true. With the switch off (the default) nothing changes.

## What
- engine/invitestep.js: the switch, once-only book (invite-step.json), first-agent signal, link check, words, stepFor. server.js: GET /api/invite-step, POST /api/invite-step/done.
- web/index.html: the dialog, on the What's New window's styles; skipped on a phone, and when another window is up (a later load).
- ios: Board.inviteStep, BoardClient.checkInviteStep once per connection, InviteStepView with ShareLink.

## Decisions
- Words: the 11-05 note's two lines, with Josh's phrase as the headline.
- Any way out counts as answered: "once" means once.
- No step at all unless the route answers ok, so this half and Ice Cream Kitty's can land in either order; company seats (403) get none.
- First agent did something = an agent wrote in a direct chat, or a task was built or closed. Rejected a time delay: the card says after a first run, not after a wait.
- Switch is an environment variable, off by default. Turning it on is a later call, not this card.

- Switch off: the page and phone still ask once per load, and the board answers at once without reading anything. Carrying a flag in an existing poll would touch a poll every board runs, for a dark feature.
- The page asks again every five minutes only while the board says it is on and waiting; the phone asks once per connection.
- Never over another window, the boot cover, or while the person is typing.

## Weakest premise
That a direct chat message or a finished task is "the first agent did something". An agent that only worked in a project room and finished nothing waits longer, which is the safe direction.

## Tests
engine/invitestep-6255.test.js, ios LogicTests, docs/browser-checks/render-invitestep-6255.js, web.modal-way-out-1316.test.js.
