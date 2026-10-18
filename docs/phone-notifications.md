# Phone notifications: every message type and its wording

kosmos#6487 (Josh, 2026-10-18: "We should configure a list of all of the message types we could send and document").
Read from the code on 2026-10-18 and checked against the push path owner's table on that card.

## How a notification travels
A computer running Kosmos notices that something happened and sends the coordinator a short event: its kind, the
agent, the project when there is one, and an id. The coordinator turns that into the words on the phone, through Apple
for an iPhone and through web push for Android and the browser.

**The words of a message are never sent.** A notification says who did what, and a tap opens that agent's page.

**Phone notifications are off until the person turns them on**: Settings, "Buzz my phone about my agents", Turn on.
That switch is off by default today; kosmos#6488 changes it. Once it is on, a notification goes out only when the kind's
own switch is on, this computer is connected to Kosmos+, and a phone or browser is signed in and this computer has allowed it. A computer still
waiting to be allowed, or a phone that was denied, gets nothing.

## Wording (the plain templates, to ship)
Short and plain: the title says who and what; the body names the project, and is left out when there is none
(everything is in Kosmos, so "in Kosmos" adds nothing).

| Kind | Title | Body |
|---|---|---|
| needs_you | `<Agent> needs you` | `in <Project>`, or no body |
| replied | `<Agent> replied` | `in <Project>`, or no body |
| posted | `<Agent> posted` | `in <Project>`, or no body |
| ready | `<Agent> has work ready for you` | `in <Project>`, or no body |

Changed from what ships today: the body said `on <Project>` (now `in`, as Josh wrote it), and `in Kosmos` when there was
no project (now no body).

**Not yet in force.** The words are built in three places, and they must be changed to match this table: the
coordinator's iPhone builder, the coordinator's web-push worker, and this repo's `web/sw.js`. Ice Cream Kitty makes that
change after kosmos#6488, with tests that keep all three equal to this table. No test reads this page yet. The test
notice (`Kosmos has something for you`, body `in Kosmos`) goes through the same wording code with no project, so the
change must keep its body on purpose (or it loses it); the
email keeps its own sentence (`<Agent> needs you on <Project>.`), since it is not a notification.

## Shipped today

| Event | When it fires | Title | Body today | Settings switch, default | How often |
|---|---|---|---|---|---|
| An agent needs you (its report) | an agent's report changes to needing the person | `<Agent> needs you` | `on <Project>`, or `in Kosmos` | When an agent needs me, on | at most once per agent per 5 minutes |
| An agent needs you (keeps crashing) | 3 runs of an agent end on their own within 30 minutes, each lasting 2 minutes or less; restarts Kosmos makes itself do not count (told once per loop) | `<Agent> needs you` | `in Kosmos` | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent needs you (stuck) | an agent's sign-in has been expired for 15 minutes, or a usage limit has held it for 30 minutes | `<Agent> needs you` | `in Kosmos` | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent needs you (a helper gave up) | one of the agent's helpers gives up (a quota resume, an idle nudge, or the first-reply reminder); not while the agent already shows needs-you | `<Agent> needs you` | `in Kosmos` | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent answered you | an agent writes to the person in its direct chat (whether or not the person wrote first) | `<Agent> replied` | `in Kosmos` (a reply carries no project) | When an agent answers me, on | every reply |
| An agent replied to your post | an agent's project post answers a post the person wrote, sent with the agent's own token | `<Agent> posted` | `on <Project>`, or `in Kosmos` | When an agent replies to a post of mine, on | at most once per agent per 5 minutes |
| Any other agent post in a room (not a reply to the person's post) | an agent posts in any project room with its own token (the code does not check that the person is in it, though the switch's label says "I am on") | `<Agent> posted` | `on <Project>`, or `in Kosmos` | When anyone posts in a project room I am on, off | at most once per room per 10 minutes |
| Work ready for you | an agent (not the person) marks a task built, when that changes the task | `<Agent> has work ready for you` | `on <Project>`, or `in Kosmos` | When work is ready for my check, on | at most once per agent per 5 minutes |
| Test notice | the operator sends a test from the coordinator (iPhone only; a tap opens nothing) | `Kosmos has something for you` | `in Kosmos` | none (operator only) | on demand |

The four "needs you" rows share ONE 5-minute window per agent: a needs-you that lands inside the window of an earlier
one from the same agent is not sent at all (it is dropped, not delayed), and a crash, stuck or helper notice dropped
this way is not tried again for that episode. (One exception today, kosmos#6495: the crash notice keys the agent by a cleaned-up name, so
for an agent whose session name has anything but lowercase letters, digits, `-` and `_` it has its own window.) 

The other windows are separate: "work ready" and "replied to your post" each have their own 5 minutes per agent, so one
agent can buzz once for each inside the same 5 minutes. Restarting Kosmos clears the windows. It also restarts the stuck and helper clocks, so those
notices come again only after another full wait; and it forgets which crash loops were already told, so a loop still
going is told again straight after a restart.

The stuck and helper notices cover only agents Kosmos itself set up. A helper give-up while the agent already shows
needs-you is not sent; for the idle nudge and the first-reply reminder it is cleared at once. A quota give-up (the
Antigravity quota helper) is cleared once the agent is working again, but once the agent stops showing needs-you without
being back at work, it is sent.

Tapping a notification opens that agent's page, even for a project post (or the board's home when the agent's session name has
anything but lowercase letters, digits, `-` and `_`, starts with `-` or `_`, or is longer than 64 characters). The crash notice is the
exception: it sends the cleaned-up name (kosmos#6495), so for such an agent the tap can open a page for a name that is
not quite the agent's. A reply, a crash, a stuck terminal and a helper giving up never carry a project, so their
body is `in Kosmos` today and none under the new wording. A reply or post written while Kosmos was closed, and delivered later, does
not buzz, and neither does a post sent without the agent's token. A reply to the person's post uses only the "replies
to a post of mine" switch; it does not fall back to the room switch when that one is off.

An event of any other kind from a computer cannot reach a phone: the computer and the coordinator both refuse a kind they do not know.

Sound: the default sound on every kind. Grouping: none yet; each notification stands alone.

## Built, not on

| Event | When it would fire | Wording | Status |
|---|---|---|---|
| An agent needs you, by email | a needs-you this computer sent to Kosmos+ (so the master and "When an agent needs me" switches on, and not dropped by the 5-minute window, and the computer already allowed; no phone needed) and not acknowledged within 30 minutes, checked every minute (nothing in Kosmos sends that acknowledgement yet, see below); never one older than 6 hours; at most once per agent per account per day | subject `<Agent> needs you`; first line `<Agent> needs you on <Project>.` (no "on" part without a project), then how to open Kosmos, and "Your agent paused for your input and will pick up again once you answer." | built, behind `KOSMOS_NEEDS_YOU_EMAIL`, which is off in production (measured on the coordinator by the push path's owner, #6487), so nothing sends today |

A computer can send needs-yous only after someone has pressed Turn on (that is what gives it the key the coordinator
checks). If kosmos#6488 makes notifications on without that press, every connected computer becomes eligible for this
email, including people who never set up a phone. **And nothing in Kosmos acknowledges a needs-you
yet** (not the board, and not the iPhone or Android app in this repo), so with the flag on, the first needs-you from each agent each day would be emailed after 30 minutes, even one the
person already answered on the board. The flag must stay off until the board sends that acknowledgement. A needs-you already 30 minutes old when the flag takes
effect (on the coordinator's next restart) is not emailed; a younger one is, once it reaches 30 minutes. The crash, stuck and helper notices are needs-you events too, so they would be emailed as well, and the email's closing
sentence ("Your agent paused for your input and will pick up again once you answer.") does not fit them; change that
before the flag is turned on. The Settings hint that promises this email still shows today and is removed under kosmos#6489.

## Proposed (Josh, 2026-10-18)
Josh's words, verbatim: "<Agent> said <message>" for a direct message, and "<Agent> commented in <Project>: <message>"
for a project.

On a phone these fall into the notification's two lines, the bold title and the text under it. Split that way:

| Event | Title | Body | Status |
|---|---|---|---|
| Direct message from an agent | `<Agent> said` | `<message>`, shortened | proposed |
| Project post | `<Agent> commented in <Project>` | `<message>`, shortened | proposed |

**This puts the words of a message on the lock screen.** Today those words never leave the computer, so it needs a
decision before it is built. Three ways:
1. The computer sends the text with the event. Simplest, but the words then pass through the coordinator and Apple.
2. The phone fetches the text from the computer itself when the notification arrives, so the coordinator and Apple
   still carry only "something happened". On an iPhone that is a notification service extension; on Android and the
   browser, the web-push worker fetches before it shows the notification. If the computer is asleep or offline, the
   plain notification above shows instead. More to build.
3. Keep today's no-words notifications and only change their wording.

Recommended: option 2. The call is Josh's.

## Where the code lives
The computer side: `engine/phonenotify.js` (kinds, switches, how often), called from `server.js`. The words:
kosmos-relay `coordinator/src/apns.rs` (`payload`, and the test notice in `operator_test`) and
`coordinator/src/sw.js` (the "today" column above is these two). This repo's `web/sw.js` also builds notification words,
differently ("posted an update", "has an update", "In <Project>", "Open Kosmos to see what happened."), though no phone push reaches it
today (phones subscribe on the coordinator's address, #3510). The email: kosmos-relay `coordinator/src/delivery.rs`
(`agent_needs_you_words`), sent by the `notify.rs` sweep.
