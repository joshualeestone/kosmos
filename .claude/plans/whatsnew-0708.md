# whatsnew-0708: the "Kosmos has been updated" highlights for 0.7.08

**Why:** release.sh step 1b-ii (#3955) refuses a cut whose `web/whats-new.json` is not for the version
being cut. 0.7.08 is due (the #1050 gap alarm: main 100+ commits past staging 0.7.07), so its highlights
must be on main before the freeze. Baron owns the cut.

## The change
`web/whats-new.json` for 0.7.08, five highlights, each checked against its merged PR:
- Sort your agents: #4440 (#4428), sorts by Last talked to, Model, Name, Needs you first, Recently active,
  Newest, Project, Role.
- Webhooks add tasks: #4453 (#1307), Project settings > Webhooks; a call adds a task that waits for a person.
- Each agent's real model: #4500 (#4416), plain-language model names.
- A rename reaches the whole page: #4437 (#4421).
- Steadier with many agents: #4481 (#4468), delivery no longer blocks the board.

## Decisions
- The Sonnet 5.5 tile (branch wnsonnet-4443, written for 0.7.07) is NOT carried: Sonnet 5.5 shipped in
  0.7.07, so by 0.7.08 it is not news. That branch is abandoned.
- #4466 (busy is not down) is not a highlight: it may miss this cut, and a highlight must be true of the
  build it ships in. If it rides, the release entry says it; the window can say it in 0.7.09.
- Weakest premise: "Steadier with many agents" is true of message delivery (#4481's measured route
  control); the board's other single-core load (#4468) is not all fixed. The line says delivery only.

## Review round 1 (fixed)
- "Every agent's model ... real name" overclaimed #4500: Muse still shows the provider (its stated limit).
  Now: "Gemini, Grok and OpenAI agents", the runners #4500 names.
- "changes its name everywhere on its page straight away" overclaimed #4437: follow-up #4423 lists places
  on the page that still keep the old name, and it lands on the next refresh. Now: "across its page: the
  title, its messages and the working line".
- Webhooks: the task "waits for you to hand out" (the product's own hint), not "for a person".
- "Steadier with many agents" uses the chat icon: the swarm icon is the Agent Swarms mark.
- The same two overclaims were in the drafted release entry (outside this repo); fixed there too.
- Deferred: the plan file name has no timestamp, the same as whatsnew-0705 and whatsnew-0707.

## Validation
- `node tools/whats-new-check.js 0.7.08` exit 0; the four suites that read the file, 409/409.
- Browser-check: the window's rendering is unchanged (JSON content only); covered by the existing check.
