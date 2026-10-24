# Phone notifications: every message type and its wording

kosmos#6487 (Josh, 2026-10-18: "We should configure a list of all of the message types we could send and document").
Read from the code on 2026-10-18 and checked against the push path owner's table on that card; the iPhone message
section was added from the code on 2026-10-23.

## Words used here
- **The coordinator**: the Kosmos+ service on the internet that passes a notification from this computer to a phone.
- **Web push**: how Android phones and browsers receive notifications (iPhones use Apple's own service).
- **Window**: a few minutes after a notification during which another of the same sort is not sent.
- **Episode**: one stretch of the same trouble, from when it starts until it clears.
- **Connected to Kosmos+**: this computer is signed in to Kosmos+ and Kosmos+ is switched on here.
- **Session name**: the agent's short internal name, such as `leo`, as opposed to the name shown on screen.
- **The agent's token**: the private pass each agent uses when it posts, so Kosmos knows the post is really from it.

## How a notification travels
A computer running Kosmos notices that something happened and sends the coordinator a short event: its kind, the
agent, the project when there is one, and an id. The coordinator turns that into the words on the phone, through Apple
for an iPhone and through web push for Android and the browser.

**The words of a message are never sent in the notification itself.** (An iPhone fetches them from the person's own
computer for two kinds of notice: see On an iPhone.) A notification says who did what, and a tap usually opens that agent's page (exceptions below).

**The master switch**: Settings, "Buzz my phone about my agents". Up to Kosmos 0.7.57 it is off until the person presses
Turn on. From the release after 0.7.57 (kosmos#6488) it turns itself on once this computer is connected to Kosmos+ (see Words used here), unless the person has
turned it off. Once it is on, a notification goes out only when the kind's
own switch is on, this computer is connected to Kosmos+, a phone or browser is signed in, and this computer has approved that phone
(one waiting for this computer's approval gets nothing, and so does one that was denied). Nothing gets through from a
computer not yet allowed onto the person's Kosmos+ account: the coordinator refuses it.

## Wording
Short and plain: the title says who and what; the body names the project, and is left out when there is none
(everything is in Kosmos, so "in Kosmos" adds nothing; the test notice is the one exception, below). An agent with no name is called "An agent".

| Kind | Title | Body |
|---|---|---|
| needs_you | `<Agent> needs you` | `in <Project>`, or no body |
| replied | `<Agent> replied` | `in <Project>`, or no body (the board sends no project with a reply today) |
| posted | `<Agent> posted` | `in <Project>`, or no body |
| ready | `<Agent> has work ready for you` | `in <Project>`, or no body |

Changed on 2026-10-18: the body said `on <Project>` (now `in`, as Josh wrote it), and `in Kosmos` when there was no
project (now no body).

**In force on the coordinator since 2026-10-18** (kosmos-relay #451, deployed per the push path's owner): iPhone and web push both take their words from
this table, through one shared function. An iPhone shows them at once. An Android phone or a browser keeps
its old copy of the coordinator's worker, which wrote `on <Project>` or `in Kosmos` itself, until it next checks for an
update (within about a day). This repo's own `web/sw.js` matches it from the release after 0.7.57 (kosmos#6502). As of
2026-10-18 nobody has seen the new words on a real phone. The test notice (`Kosmos has something for you`, body `in Kosmos`) is a
deliberate exception that keeps its body; the email keeps its own sentence (`<Agent> needs you on <Project>.`), since it is
not a notification. `web.phone-notify-catalog-6487.test.js` reads this page: it fails when the kinds or the words in
the Wording table, or the iPhone message rows below, stop matching what this repo's code shows (see Where the code lives).

## Sent today

| Event | When it fires | Title | Body | Settings switch, default | How often |
|---|---|---|---|---|---|
| An agent needs you (its report) | an agent's report changes to needing the person, including when it stops to ask permission for something | `<Agent> needs you` | `in <Project>`, or no body | When an agent needs me, on | at most once per agent per 5 minutes |
| An agent needs you (keeps crashing) | 3 runs of an agent end on their own within 30 minutes, each lasting 2 minutes or less; restarts Kosmos makes itself do not count (told once per loop) | `<Agent> needs you` | no body | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent needs you (stuck) | an agent's sign-in or key has stopped working for 15 minutes, or a usage limit has held it for 30 minutes | `<Agent> needs you` | no body | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent needs you (a helper gave up) | one to two minutes after one of the agent's helpers gives up (a quota resume, an idle nudge, or the first-reply reminder); not while the agent already shows needs-you | `<Agent> needs you` | no body | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent answered you | an agent writes to the person in its direct chat (whether or not the person wrote first) | `<Agent> replied` | no body (a reply carries no project) | When an agent answers me, on | every reply |
| An agent replied to your post | an agent's project post is a reply to one of the person's own posts (it carries the reply link), sent with the agent's own token | `<Agent> posted` | `in <Project>`, or no body | When an agent replies to a post of mine, on | at most once per agent per 5 minutes |
| Any other agent post in a room (not a reply to the person's post) | an agent posts in any project room with its own token (the code does not check that the person is in it, though the switch's label says "I am on") | `<Agent> posted` | `in <Project>`, or no body | When anyone posts in a project room I am on, off | at most once per room per 10 minutes |
| Work ready for you | an agent (not the person) marks a task built, when that changes the task | `<Agent> has work ready for you` | `in <Project>`, or no body | When work is ready for my check, on | at most once per agent per 5 minutes |
| Test notice | someone running Kosmos+ sends a test from the coordinator (iPhone only; a tap opens nothing) | `Kosmos has something for you` | `in Kosmos` | none (operator only) | on demand |

The four "needs you" rows share ONE 5-minute window per agent: a needs-you that lands inside the window of an earlier
one from the same agent is not sent at all (it is dropped, not delayed), and a crash, stuck or helper notice dropped
this way is not tried again for that episode.

The other windows are separate: "work ready" and "replied to your post" each have their own 5 minutes per agent, so one
agent can buzz once for each inside the same 5 minutes. Restarting Kosmos clears the windows. It also restarts the stuck and helper clocks, so those
notices come again only after another full wait; and it forgets which crash loops were already told, so a loop still
going is told again within about a minute of a restart. The crash notice's title shows the agent's name, or its
session name (for example `leo`) when the board cannot read that agent at that moment.

The stuck and helper notices cover only agents Kosmos itself set up. A helper give-up while the agent already shows
needs-you is not sent; for the idle nudge and the first-reply reminder it is cleared at once. A quota give-up (the
Antigravity quota helper) is cleared once the agent is working again, but once the agent stops showing needs-you without
being back at work, it is sent.

In the Android app a tap first opens the Kosmos+ sign-in page, and one more tap opens the agent (the same happens in
plain Chrome on a phone that has the app). Otherwise a tap opens that agent's page (or the board's home when the agent's session name has
anything but lowercase letters, digits, `-` and `_`, starts with `-` or `_`, or is longer than 64 characters). A project post is the exception in a browser without
the Android app (a computer's browser, or Chrome on a phone without the app): its tap opens that project's room
(kosmos#6254, live on the coordinator since 2026-10-18 with the wording above; a phone picks it up
within about a day, when its browser next checks for an update). A project the board does not know opens the projects list, and a post with no usable project opens the agent.
The Android app and the iPhone still open the agent for a project post: the Android app's sign-in step carries only the
agent, and the iPhone notification carries no project id. A reply, a crash, a stuck terminal and a helper giving up never carry a project, so they
have no body. A reply or post written while Kosmos was closed, and delivered later, does
not buzz, and neither does a post sent without the agent's token. A reply to the person's post uses only the "replies
to a post of mine" switch; it does not fall back to the room switch when that one is off.

An event of any other kind from a computer cannot reach a phone: the computer and the coordinator both refuse a kind they do not know.

Sound: the default sound on iPhone; on Android and the browser, whatever the device does. Grouping: none yet; each notification stands alone.

## On an iPhone: the message itself

Built and merged 2026-10-22 and 10-23 (kosmos#6942 the iPhone's notification extension, #6943 the computer's answer,
#6972 message style, kosmos-relay #564 live on the coordinator). It reaches a person with Kosmos 0.7.64 on their computer
and an iPhone app build that carries the extension (TestFlight build 2, valid 2026-10-23). As of 2026-10-23 nobody has
seen it on a real phone.

When an iPhone notification for one of the two events below arrives, the iPhone asks the person's own computer, through
Kosmos+ remote and the sign-in the app already keeps for that computer, for the words behind it. If the computer answers
within 15 seconds, the notification shows them as a message from the agent:

| Event | Title | Subtitle | Text | Picture |
|---|---|---|---|---|
| An agent needs you (its report) | `<Agent>` | `<Agent> needs you, in <Project>`, or `<Agent> needs you` | the report's reason, shortened to about 400 characters: what the agent wrote (`kosmos report needs_you "..."`), or, when it stopped to ask permission, `asking permission to use <tool>`, with `: <command>` when there is one | the agent's picture, when it has one |
| An agent answered you | `<Agent>` | `<Agent> replied` | the reply, shortened to about 400 characters | the agent's picture, when it has one |

The computer also answers a room post's id (`post:<post id>`, kosmos#7032): the post's text and its author, never the
person's own post, and the iPhone asks for it, so a room notice shows what was said (with no Reply: answering a room
is a post to everyone, made in the room). The answer also names the post's project (`project`), because the push
does not: the iPhone's push carries no project, so the phone learns which room a tap opens from the computer. A tap
opens that project's room in the iPhone's Projects tab, or the board's room page under Today when the notice came from
another computer than the one the app keeps, or the project is archived. When the computer did not answer in time, the
notice has no room in it and a tap opens the agent's page, as before.

The words are never in the push: the coordinator's notification and Apple still carry only who and what, and the
phone fetches the words from the computer over Kosmos+ remote. If the computer does not answer (asleep, offline, an older Kosmos, or a phone not signed in to that
computer), the notification shows as in Sent today. Every other row of Sent today (crash, stuck, helper, posts, work
ready) is not asked about and always shows as there. Android and the browser do not ask yet: they show Sent today's words.

**A permission request puts the command on the lock screen.** When an agent stops to ask permission, its report's
reason names the tool and the command (up to 200 characters of it), and that is the text an iPhone shows. The
picture is fetched after the words with its own 8 seconds; a notice whose picture is late shows without one. Whether
iOS keeps the subtitle on a message-style notice is not yet seen on a real phone.

**Allow and Deny on a permission request (kosmos#7017 part 2).** When the agent is stopped on Claude Code's permission
prompt for a one-line command (title exactly "Bash command") and the board itself would show that card's buttons, the
computer's answer also carries the request, and the text becomes the request in the board card's words: Claude Code's
reason first, then `Wants to run a command:` and the command on its own line, then `It says: <the agent's words>`.
The notification then offers Allow and Deny, both asking to unlock the phone. A press re-reads the chat first and goes
only while the same request is still up; the person is always told the outcome. No buttons (the text stays as above)
for a file, a multi-line command, any other tool, a request longer than about 400 characters, characters that draw
differently on a phone, or anything shaped like a credential. Never an "always allow" choice.

## Built, not on

| Event | When it would fire | Wording | Status |
|---|---|---|---|
| An agent needs you, by email | a needs-you this computer sent to Kosmos+ (so the master and "When an agent needs me" switches on, and not dropped by the 5-minute window, and the computer already allowed; no phone needed) and not acknowledged within 30 minutes, checked every minute (nothing in Kosmos sends that acknowledgement yet, see below); never one older than 6 hours; at most once per agent per account per 24 hours | subject `<Agent> needs you`; first line `<Agent> needs you on <Project>.` (its own wording, see Wording; no "on" part without a project), then how to open Kosmos, and "Your agent paused for your input and will pick up again once you answer." | built, behind `KOSMOS_NEEDS_YOU_EMAIL`, which is off in production (measured on the coordinator by the push path's owner, #6487), so nothing sends today |

A computer can send needs-yous only once the master switch is on (that is what gives it the key the coordinator checks).
From the release after 0.7.57 that happens by itself once a computer is connected to Kosmos+, so every connected computer becomes eligible
for this email, including people who never set up a phone. **And nothing in Kosmos acknowledges a needs-you
yet** (not the board, and not the iPhone or Android app in this repo), so with the flag on, the first needs-you from each agent in any 24 hours would be emailed after 30 minutes, even one the
person already answered on the board. The flag must stay off until the board sends that acknowledgement. A needs-you that turned 30 minutes old while the
coordinator was running with the flag off is never emailed; a younger one is, once it reaches 30 minutes. The crash, stuck and helper notices are needs-you events too, so they would be emailed as well, and the email's closing
sentence ("Your agent paused for your input and will pick up again once you answer.") does not fit them; change that
before the flag is turned on. The Settings hint's sentence about this email ("may also send you an email") shows up to Kosmos 0.7.57 and is gone from the release after it (kosmos#6489).

## Proposed (Josh, 2026-10-18)
Josh's words, verbatim: "<Agent> said <message>" for a direct message, and "<Agent> commented in <Project>: <message>"
for a project.

On a phone these fall into the notification's two lines, the bold title and the text under it. Split that way:

| Event | Title | Body | Status |
|---|---|---|---|
| Direct message from an agent | `<Agent> said` | `<message>`, shortened | built on iPhone in a different shape: see On an iPhone (the agent's name as the title, `<Agent> replied` under it, then the message) |
| Project post | `<Agent> commented in <Project>` | `<message>`, shortened | proposed |

**This puts the words of a message on the lock screen.** Three ways were weighed on 2026-10-18:
1. The computer sends the text with the event. Simplest, but the words then pass through the coordinator and Apple.
2. The phone fetches the text from the computer itself when the notification arrives, so the coordinator and Apple
   still carry only "something happened". On an iPhone that is a notification service extension; on Android and the
   browser, the web-push worker fetches before it shows the notification. If the computer is asleep or offline, the
   plain notification above shows instead. More to build.
3. Keep the no-words notifications as they are now.

Josh chose option 2 on 2026-10-22 (13:28: "use the agent avatar and put the actual text, like discord does"). It is
built for the iPhone (On an iPhone); the Android and browser half, and the project post, are not built yet.

## Where the code lives
The computer side: `engine/phonenotify.js` (kinds, switches, how often, and from the release after 0.7.57 the default turn-on), called from `server.js`. The words:
kosmos-relay `coordinator/src/push.rs` (`notice_text`, used by `apns.rs` `payload` for iPhone and by `push.rs` `web_payload` for
web push, which `coordinator/src/sw.js` shows as it arrives; it also words the test notice, which `apns.rs`
`operator_test_with` sends). This repo's `web/sw.js` shows the same words from
the release after 0.7.57 (#6502), though no phone push reaches it today (phones subscribe on the coordinator's address, #3510). The email: kosmos-relay `coordinator/src/delivery.rs`
(`agent_needs_you_words`), sent by the `notify.rs` sweep.
The iPhone message rows: the computer's answer is `engine/phonenotice.js` (which events it answers, and the shortening),
served by `server.js` at `GET /api/phone/notice`; the iPhone side is `ios/KosmosNotice/NotificationService.swift` (title,
subtitle, text) and `ios/KosmosNotice/NoticeLogic.swift` (which notices it asks about).
