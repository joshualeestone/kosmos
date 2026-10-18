# Phone notifications: every message type and its wording

kosmos#6487 (Josh, 2026-10-18: "We should configure a list of all of the message types we could send and document").
Shipped rows read from the code on 2026-10-18 and confirmed by the push path's owner (kosmos#6487; the event table with
its server.js lines is in that card's comments).

## How a notification travels
A computer running Kosmos decides that something happened (`engine/phonenotify.js`, called from `server.js`) and sends
the coordinator a short event: its kind, the agent, the project, and an id. The coordinator turns the event into the
words on the phone for iPhone (`coordinator/src/apns.rs` `payload`, sent through Apple). The same words are built
twice more for web push (Android and the browser): by the coordinator's `coordinator/src/sw.js` and by this repo's
`web/sw.js`. All three must match this page; tests check them.
**The words of a message are never sent**: the notification says that something happened and who, and the
conversation opens on a tap.

Nothing is sent until phone notifications are on (the master switch; its default is changing to on under kosmos#6488)
and a phone is signed in. Each kind below has its own switch under that.

## Wording (the plain templates, to ship now)
Short and plain: the title says who and what; the body names the project, and is left out when there is none
(everything is in Kosmos, so saying "in Kosmos" adds nothing).

| Kind | Title | Body |
|---|---|---|
| needs_you | `<Agent> needs you` | `in <Project>`, or no body |
| replied | `<Agent> replied` | `in <Project>`, or no body |
| posted | `<Agent> posted` | `in <Project>` |
| ready | `<Agent> has work ready for you` | `in <Project>`, or no body |
| anything else | `<Agent> has something for you` | no body |

Changed from what ships today: the body said `on <Project>` (now `in`, as Josh wrote it), and `in Kosmos` when there
was no project (now no body).

## Shipped today

| Event | When | Title | Body | Switch, default | Repeats |
|---|---|---|---|---|---|
| An agent needs you | an agent's report asks for the person; or it keeps crashing, is stuck at its terminal, or works outside its limits | `<Agent> needs you` | `on <Project>`, or `in Kosmos` | Needs you, on | at most once per agent per 5 minutes |
| An agent answered you | an agent replies to the person's direct message | `<Agent> replied` | `on <Project>`, or `in Kosmos` | Replies, on | every reply |
| An agent posted for you | a project post that names the person | `<Agent> posted` | `on <Project>` | Mentions, on | at most once per agent per 5 minutes |
| Any project post | any other project post (opt-in) | `<Agent> posted` | `on <Project>` | Every project post, off | at most once per project per 10 minutes |
| Work ready for you | an agent marks a task built | `<Agent> has work ready for you` | `on <Project>`, or `in Kosmos` | Work ready, on | at most once per agent per 5 minutes |
| Anything else | a kind the coordinator does not know | `<Agent> has something for you` | `in Kosmos` | (none) | (none) |

## Built, not on

| Event | Where | Wording | Status |
|---|---|---|---|
| An agent needs you, by email | coordinator `delivery.rs` (`agent_needs_you_words`), sent by the `notify.rs` sweep | says `on <Project>` | built, behind `KOSMOS_NEEDS_YOU_EMAIL`, which is off in production, so nothing sends today |

The Settings hint that the phone switch "may also send you an email" is not true while that flag is off.

Sound: the default sound on every kind. Grouping: none yet (each notification stands alone).

## Proposed (Josh, 2026-10-18)

| Event | Title | Body | Status |
|---|---|---|---|
| Direct message from an agent | `<Agent>` | `<message>`, shortened | proposed |
| Project post | `<Agent> in <Project>` | `<message>`, shortened | proposed |

Josh's wording: "<Agent> said <message>" for a direct message and "<Agent> commented in <Project>: <message>" for a
project.

**This puts the words of a message on the lock screen, and through the coordinator and Apple, which today never
see them.** Three ways to do it, to decide before it is built:
1. The computer sends the text with the event. The simplest, but the words leave the computer for the coordinator and
   Apple.
2. The iPhone fetches the text itself when the notification arrives (a notification service extension), so the
   coordinator and Apple still carry only "something happened". The words stay between the computer and the phone,
   at the cost of more to build.
3. Keep today's no-words notifications and only improve their wording.
