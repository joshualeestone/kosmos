# Phone notifications: every message type and its wording

kosmos#6487 (Josh, 2026-10-18: "We should configure a list of all of the message types we could send and document").
DRAFT. The shipped rows were read from the code on 2026-10-18; the push path's owner has not confirmed them yet.

## How a notification travels
A computer running Kosmos decides that something happened (`engine/phonenotify.js`, called from `server.js`) and sends
the coordinator a short event: its kind, the agent, the project, and an id. The coordinator turns the event into the
words on the phone (`coordinator/src/apns.rs` `payload` for iPhone, `push.rs` for the web) and sends it through Apple.
**The words of a message are never sent**: the notification says that something happened and who, and the
conversation opens on a tap.

Nothing is sent until the person turns phone notifications on (the master switch is off by default) and has a phone
signed in. Each kind below has its own switch under that.

## Shipped

| Event | When | Title | Body | Switch, default | Repeats |
|---|---|---|---|---|---|
| An agent needs you | an agent's report asks for the person; or it keeps crashing, is stuck at its terminal, or works outside its limits | `<Agent> needs you` | `on <Project>`, or `in Kosmos` | Needs you, on | at most once per agent per 5 minutes |
| An agent answered you | an agent replies to the person's direct message | `<Agent> replied` | `on <Project>`, or `in Kosmos` | Replies, on | every reply |
| An agent posted for you | a project post that names the person | `<Agent> posted` | `on <Project>` | Mentions, on | at most once per agent per 5 minutes |
| Any project post | any other project post (opt-in) | `<Agent> posted` | `on <Project>` | Every project post, off | at most once per project per 10 minutes |
| Work ready for you | an agent marks a task built | `<Agent> has work ready for you` | `on <Project>`, or `in Kosmos` | Work ready, on | at most once per agent per 5 minutes |
| Anything else | a kind the coordinator does not know | `<Agent> has something for you` | `in Kosmos` | (none) | (none) |

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
