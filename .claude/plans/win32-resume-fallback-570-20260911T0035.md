# win32-resume-fallback-570: an agent that crashes before its first message comes back (#2726)

Addresses #2726 and #570. Found live on the Windows box while verifying #2722.

## The defect

When a Windows agent's `claude` process dies, `superviseStreaming` relaunches it
with `--resume <handle.sessionId>` so the conversation continues. An agent that
has never been sent a message has no saved conversation, so that resume can never
succeed:

- the resumed child dies about 1s after it starts;
- `schedule()` waits out the 30s throttle, then resumes the same id again, forever;
- the card reads "stopped", and nothing can be delivered;
- only a task restart or a reboot (a fresh session) recovers it.

Task starts are always fresh, so the earlier restart checks never exercised this
path.

## Measured on the box (Claude Code 2.1.268)

`claude -p --input-format stream-json --output-format stream-json --verbose --resume <missing id>`:

- prints `No conversation found with session ID: <id>` on stderr;
- emits ONE stdout event: `{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"session_id":"<id>","errors":["No conversation found with session ID: <id>"]}`;
- exits 1 after about 1.1s.

The real supervisor, with its stderr captured (`crash-repro.js`), logged `resumed`
then `died -- it said: No conversation found with session ID: ...`, every 30s.

## Design

- **The signal is the structured result event, not the stderr text.** A child
  launched as a RESUME that emits a `result` with `is_error` and an `errors` entry
  starting `No conversation found with session ID` has nothing to resume. This is
  `win32streamstate`'s parse of that line, in the same stdout reader the state
  sink uses. A fresh start never keys on it.
- **On that child's death, the next start is a birth.** `gone()` sets
  `handle.sessionId = null`, so `startOnce` calls `prepareSession`: a new id, a
  new ownership row, a new token. It forgets the old id's row, which never had a
  conversation and can never be resumed. A failed forget is reported, the same way
  as `forget-failed` in #2669. It emits `resume-impossible`, naming the id, so the
  task log shows why the conversation was not continued.
- **Every other death still resumes the same id.** A real conversation is never
  abandoned because some other error happened.
- The throttle is unchanged: the fresh start waits out the same 30s as any restart.

## Tests

- A resumed child that emits the no-conversation result and dies: the next launch
  is fresh (no `resumeSessionId`), the old id is forgotten, and the event names
  it.
- A resumed child that dies with any other error: the next launch resumes the same
  id.
- A FRESH child that emits such a result: the next launch still resumes the id
  that launch recorded.
- A controls run: every test fails without its fix.
- Live on the box, with `crash-repro.js`: kill a never-messaged agent's child; the
  supervisor starts fresh once, and the card comes back idle.

## Stacking

This edits the same stdout reader and death handler as `win32-clear-rekey-2669`
(#2669), so it is stacked on that branch. After #2669 squash-merges, this branch
is rebased with `git rebase --onto origin/main <#2669 head>`.

## Weakest part

- **The match is on claude's error text** inside a structured field. If a future
  claude rewords it, the loop comes back. The test pins today's measured wording,
  and the plan records the version.
- **The resumed conversation is abandoned only on this one error.** If claude
  ever reported "no conversation" for a session that does have one on disk, the
  agent would silently start over. Nothing observed suggests that.
