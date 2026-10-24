# renamepush-4421: a push sent after a rename carries the new name (kosmos#4421)

The card's body lists notifications among the surfaces that must follow a rename. #4437 fixed the page, and
server.rename-4421 / rename-followups-4423 cover cards and rooms (27/27 on the served 0.7.61 tree). No test sent a
phone push after a rename, so that item was reasoned, not measured. Splinter (10-21 02:40): build the test; if it
fails, the bug is mine.

## The test
`server.rename-push-4421.test.js`: one agent born "Gemini-Sub Born" (its CLAUDE.md "You are **...**" line, the
same fixture shape as server.rename-4421), Kosmos+ live (enrolled + switch on, as server.phonenotify-718's enrol()),
notifications turned on through the real PUT /api/phone-notify (fake tunnel mints the token), a stub sender.
- Before the rename: a needs_you report and a reply each push; both payloads' `agent` is the born name (CONTROL:
  a payload that never moves fails here).
- Rename through the real PUT /api/agent/:name/profile.
- After: the same two pushes carry the new name.

## Measured
- Passes on the branch, which is origin/main plus this test.
- Red-capable, each arm on its own (both mutants in server.js, restored by `git checkout -- server.js`):
  - both `agent: sender.card.name || who` sites changed to `agent: who`: fails the born-name CONTROL ("before the
    rename the pushes were not exactly these");
  - both changed to remember the first name pushed per agent (`(globalThis.__staleName ||= {})[who] ||= (...)`, a
    stale cache): passes the control and fails the AFTER arm ("the pushes after the rename were not exactly these,
    with the new name").
- Re-run: `TMUX_PANE= TMUX= node --test server.rename-push-4421.test.js` from the worktree.
- File-scanning guards: `node --test fixture-discipline.test.js no-name-refs-3071.test.js no-brand-refs-1881.test.js
  comment-deferral.test.js one-derivation.test.js bundle.contents.test.js engine.reachable.test.js`, 45/45.

## Not covered: reasoned, not measured
The `posted` (room post) and `ready` (task built) pushes read the live card's name too, and the crash-loop family
names the agent from a `shown` map built each tick from the live roster. Reading the source, they should follow a
rename the same way, but no test here sends them, and the file header says so.
`posted` builds its sender with `senderFromAgentToken(req, body, roster)`, from the same live roster the measured
reply path reads, and server.phonenotify-718.test.js pins that source line. A real room post needs a project,
membership and delivery, which no end-to-end test here sets up yet; that is the follow-up if one is wanted. This test drives the two pushes an agent causes itself: a DM reply, and the needs-you change.

## Review round 1
- The pushes are now compared as an ordered [kind, agent] list, so a second push (say a stale-named one beside the
  right one) fails. A by-kind map hid it.
- Kosmos+ is made live after start(), as the sibling does; before it, boot started the fake tunnel as the connector.
- One cooldown reset per round, with a comment, and the 'working' report says why it is there.

## Review round 2
- Header narrowed to the two pushes it sends; the plan's untested kinds are labelled reasoned.
- An explicit count check, with a message naming the needs_you and replied preconditions, so an empty send fails clearly.
- This plan is committed with the branch (the repo tracks plans).

## Review round 3
- `posted` push left unmeasured, with the reasoning above (same roster as the reply path; source line pinned).
- Dropped an unused AGENT_WORKFORCE_FAKE_PANES line and a setClock(null) for a clock this file never sets.

## Review round 4
- The after arm is now shown red on its own, by a stale-name mutant that passes the control (above).
- The guard command is named so the 45/45 can be re-run.

## Review round 5
- The plan no longer says the card's screenshot shows a push (it shows the DM title, labels and working line).
- After the rename, the test reads the card's name from /api/status first, so a red after arm points at the push.
- A comment says the provider does not matter to the push path.
