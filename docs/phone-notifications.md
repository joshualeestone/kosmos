# Phone notifications: every message type and its wording

kosmos#6487 (Josh, 2026-10-18: "We should configure a list of all of the message types we could send and document").
Read from the code on 2026-10-18 and checked against the push path owner's table on that card.

## How a notification travels
A computer running Kosmos notices that something happened and sends the coordinator a short event: its kind, the
agent, the project when there is one, and an id. The coordinator turns that into the words on the phone, through Apple
for an iPhone and through web push for Android and the browser.

**The words of a message are never sent.** A notification says who did what, and the conversation opens on a tap.

**Phone notifications are off until the person turns them on**: Settings, "Buzz my phone about my agents", Turn on.
That switch is off by default today; kosmos#6488 changes it. Once it is on, a notification goes out only when the kind's
own switch is on, this computer is connected to Kosmos+, and a phone is signed in to the Kosmos app. A computer still
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
change after kosmos#6488, with tests that keep all three equal to this table. No test reads this page yet.

## Shipped today

| Event | When it fires | Title | Body today | Settings switch, default | How often |
|---|---|---|---|---|---|
| An agent needs you (its report) | an agent's report changes to needing the person | `<Agent> needs you` | `on <Project>`, or `in Kosmos` | When an agent needs me, on | at most once per agent per 5 minutes |
| An agent needs you (keeps crashing) | an agent restarts again and again, each run short | `<Agent> needs you` | `in Kosmos` | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent needs you (stuck) | an agent's terminal is stuck on a prompt for some minutes | `<Agent> needs you` | `in Kosmos` | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent needs you (a helper gave up) | one of the agent's helpers gives up, for example when its quota or its nudges run out | `<Agent> needs you` | `in Kosmos` | When an agent needs me, on | once per episode, and at most once per agent per 5 minutes |
| An agent answered you | an agent replies to the person's direct message | `<Agent> replied` | `in Kosmos` (a reply carries no project) | When an agent answers me, on | every reply |
| An agent replied to your post | an agent's project post answers a post the person wrote | `<Agent> posted` | `on <Project>`, or `in Kosmos` | When an agent replies to a post of mine, on | at most once per agent per 5 minutes |
| Any agent post in a room | an agent posts in any project room (the code does not check that the person is in it, though the switch's label says "I am on") | `<Agent> posted` | `on <Project>`, or `in Kosmos` | When anyone posts in a project room I am on, off | at most once per room per 10 minutes |
| Work ready for you | an agent (not the person) marks a task built, when that changes the task | `<Agent> has work ready for you` | `on <Project>`, or `in Kosmos` | When work is ready for my check, on | at most once per agent per 5 minutes |
| Test notice | the operator sends a test from the coordinator (iPhone only) | `Kosmos has something for you` | `in Kosmos` | none (operator only) | on demand |

The four "needs you" rows share ONE 5-minute window per agent: after a report notice, a crash notice from the same agent
waits for that window too. A reply, a crash, a stuck terminal and a helper giving up never carry a project, so their
body is `in Kosmos` today and none under the new wording. A reply to the person's post uses only the "replies to a post
of mine" switch; it does not fall back to the room switch when that one is off.

An event of any other kind cannot reach a phone: the computer and the coordinator both refuse a kind they do not know.

Sound: the default sound on every kind. Grouping: none yet; each notification stands alone.

## Built, not on

| Event | When it would fire | Wording | Status |
|---|---|---|---|
| An agent needs you, by email | a needs-you nobody has acknowledged for 30 minutes; never one older than 6 hours; at most once per agent per account per day | subject `<Agent> needs you`; first line `<Agent> needs you on <Project>.` (no "on" part without a project), then how to open Kosmos, and "Your agent paused for your input and will pick up again once you answer." | built, behind `KOSMOS_NEEDS_YOU_EMAIL`, which is off in production, so nothing sends today |

If that flag is turned on after kosmos#6488 makes the master switch on by default, every connected computer becomes
eligible for this email, including people who never set up a phone. Needs-yous from before the flag was turned on are not
emailed. The Settings hint that promises this email is removed under kosmos#6489.

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
differently ("posted an update", "In <Project>", "Open Kosmos to see what happened."), though no phone push reaches it
today (phones subscribe on the coordinator's address, #3510). The email: kosmos-relay `coordinator/src/delivery.rs`
(`agent_needs_you_words`), sent by the `notify.rs` sweep.
