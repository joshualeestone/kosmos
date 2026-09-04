# Plan: give task conversations a transcript (#992)

## The reframing (verified, not assumed)
The card's premise is false. A task (engine/tasks.js) is a kanban item (number,
sentence, detail, parts, who) with NO message concept. Operator<->agent dialogue
goes through the PROJECT ROOM (engine/chat.js / engine/messages.js), addressed to
an agent, never associated with a task. The assigned agent's real working
transcript lives in its OWN Claude/Codex session dir (~/.claude/projects,
~/.codex/sessions) which Kosmos reads but does not own; the tmux pane is captured
live and never stored. So there was no task conversation to persist -- this is a
define-then-capture, not a persist-an-existing.

## Josh's settled rulings (from the card)
- Storage stays under app data (store.ROOT). The store.js:6-7 rule is NOT reversed:
  nothing lands in the user's project folder.
- The requirement is REACHABILITY, not location: every conversation stored, a
  button that opens it, in BOTH project settings (exists: /api/chats/reveal) and
  TASK settings (does not exist yet).
- The one undecided thing: the messages.js retention debt (whole-file re-read on
  every send, no rotation) -- adding task transcripts to that log doubles it.

## My decision (Josh decide-and-continue)
A task's recorded conversation = an append-only PER-TASK transcript under app data,
capturing the text Kosmos controls and, until now, discarded: the task lifecycle
(created / part-added / assigned / part-closed / part-reopened / closed / reopened).

- **Storage shape, decided once:** `store.ROOT/task-chats/<projectId>.task-<n>.jsonl`,
  keyed by (projectId, number) -- the only thing that names a task uniquely (a
  task's number is issued by its project and unique only there). Mirrors chat.js's
  per-thread file scheme.
- **Retention-safe by construction** (the undecided thing, answered): a per-task
  FILE, not the single messages.jsonl. record() APPENDS one line and never reads
  the file back; read() loads exactly one task's small file. No whole-file re-read,
  no shared-log doubling.
- **Best-effort:** record() catches its own failures and returns false, so a failed
  append can never break the task write that triggered it (the task is the source
  of truth). read() validates shape and skips malformed lines, like messages.js.
- **Paths computed at call time** (store.ROOT is a lazy getter), so tests sandbox
  via AGENT_WORKFORCE_DATA and a late data-root change is honored.

## What this PR delivers
- engine/taskchat.js -- the store (record / read / taskChatsDir / taskChatFile).
- engine/tasks.js -- wired at every lifecycle point; each call sits AFTER the
  successful projects.mutate / writeParts, so a refused write records nothing; an
  assignment resubmit of the current agent (moved false) records nothing.
- taskchat.992.test.js -- 12 tests: round-trip + `at` stamp + append order,
  per-task and per-project file isolation, [] on missing/unreadable/invalid,
  fail-soft on bad input, malformed-line skip, control-char flattening,
  append-not-rewrite (retention), under-app-data-not-project-folder, and the
  tasks.js integration (create/close/reopen/assign + resubmit-records-nothing +
  refused-write-records-nothing).

## Deliberate follow-ups (scoped, NOT in this PR)
1. **Task-Settings reveal button + route** -- the project half already exists
   (POST /api/chats/reveal opens store.ROOT/chats). A sibling
   POST /api/task/<projectId>/<n>/reveal opening the task-chats location + a button
   in the task view. Small, but touches the very large server.js + web/index.html;
   clean as its own slice now that the store it points at exists and will not move.
2. **The assignment line typed into the pane** (currently ephemeral in server.js)
   -- record its text as an `assigned` event field.
3. **A pointer to the agent's external Claude/Codex session** for the task, so the
   reveal can also reach the working transcript Kosmos does not own.

## Weakest premise
That "record the text that goes into a task" is well-served by the lifecycle events
Kosmos controls, rather than requiring the agent's full external working transcript.
Josh's words were "all the text and information that goes into those." The lifecycle
+ the pane line + a pointer to the external session (follow-ups 2/3) cover that
without copying logs Claude/Codex own; if Josh wants the external transcript COPIED
into app data, that is a larger, higher-risk piece (size, retention, privacy) and a
separate decision. Reversible: the store shape does not change if that is added.
