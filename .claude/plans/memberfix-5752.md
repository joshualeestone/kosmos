# memberfix-5752: a refusal for not being on the project names its fix (slice 2 of #5752)

Card: joshualeestone/kosmos#5752 (decision comment, night shift 2026-10-10). Slice 1 (dailytimes-5752) is separate.

## Change
- engine/messages.js: `NOT_ON_PROJECT_FIX` (exported; projects.js requires messages.js, so it lives here), appended to
  the room post and react refusals. server.js uses it for every refusal of an agent's OWN action on a project it is
  not on: the shared `notOnProjectRefusal` (task add, close/act, change, move), the repeat/ran route, the built mark, a
  task message, the task read, the room read, and an agent setting its own role (not the person's screen). The sentence
  keeps its start, so callers matching the start still match: "...; ask the person to add this agent with the +
  beside Members on the project's page, then run the same command again".
- A token-only read whose token names no agent (an older key-only token whose key another name also holds) now says
  "Kosmos could not tell which agent this token belongs to", with no fix: adding the agent would not help.
- Not changed: refusals about giving a task or part to ANOTHER agent (engine/tasks.js), whose fix is different, and
  the 404/409 "that agent is not on this project" answers of the membership routes themselves.

## Why not add the agent automatically (the card's first option)
Kosmos does not start scheduled work, so there is no placement step to hook. Adding on the refused write would let any
agent join any project by writing to one of its tasks; membership is the gate that keeps a project to its team. The
person stays the one who adds members, and the agent is now told exactly how to ask.

## Review round 1 fixes
- The room post, react and own-role refusals carry the fix too (they were missed).
- A token that names no agent is not told to get added.
- The wording says "the + beside Members" (the tab view shows no "Add member" text).
- The two CLI tests' stubbed refusals use the real sentence.

## Tests
- server.task-repeat-4787.test.js: the full sentence for a rule and a run by a non-member, then one arm per write site
  (add, built, message, run), with a member's run as the control.
- server.agent-reads-4491.test.js: the full sentence for the task read and the room read (text arm, exact), and the
  no-fix sentence for a token that names nobody (the resolver gives that exact answer for the test's token).
- server.agent-projects-4491.test.js: the post and react refusals through /api/post and /api/react.
- server.task-repeat-4787.test.js also: an agent's own role (with the fix) and the person's (without it).
- Each of the six sites was removed in turn and its arm went red.

## Weakest premise
That "the + beside Members on the project's page" is how the person adds a member wherever they are. In the tab view
the button shows only "+" (its accessible name is "Add member"); in the consolidated layout the opener is the rail's
"+" ("Add an agent to this project"); with the federation gate on, the "+" opens a menu ("Add one of your agents").
The Kosmos+ remote view serves the same page. Not checked on a phone.

## Not covered
- Slice 3: a notice on the person's board where the refusal happened, with an Add as member button.

## Review round 2 fixes
- An agent still on the project's record but removed from Kosmos is filtered out of the room before the post and
  react checks; it now gets the sentence WITHOUT the fix (adding it again would not help). The removed-agent tests in
  engine/messages.test.js and engine/reactions-2255.test.js assert the fix is absent, with a stranger as the control.
- Left as is (NITs): close/act and move share the helper with add, which is tested; the "could not tell which agent
  this token belongs to" sentence is not matched by the bash CLI's restart hint (it is accurate as it stands).
