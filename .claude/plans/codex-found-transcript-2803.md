# Plan: a found-but-idle Codex rollout must not read "cannot find a transcript" (kosmos#2803)

## Problem

Josh, testing 0.6.56 on the Mortals box: a working agent running on a
Codex / ChatGPT-subscription account showed, in its Memory tab, "Sub-Zero's
memory could not be read. We cannot find a transcript for it." The agent was
actively running and responding, so claiming its transcript cannot be found is
false to the user.

## Root cause

`readCodexContext(agentName, sess)` in `engine/status.js` collapsed two
different states into one branch:

```js
if (!sess.found || sess.contextUsed == null) {
  if (notYetStarted(agentName)) return notYetResult();
  if (neverRecorded(agentName)) return neverRecordedResult();
  return { ...NONE_BASE, notYet: false, because: NO_READING.NO_TRANSCRIPT };
}
```

- `!sess.found` — no rollout matched the agent's workdir. The ladder below is
  defensible here: we genuinely have no transcript.
- `sess.found && sess.contextUsed == null` — the rollout WAS matched and read,
  the agent simply has not completed a turn that emitted a `token_count` event
  yet (a working agent early in its first turn). Holding the read session is
  positive proof the transcript exists.

The second case still fell through to the `notYetStarted` / `neverRecorded` /
`NO_TRANSCRIPT` ladder, which can answer "we cannot find a transcript for it"
(NO_TRANSCRIPT) or "made before Kosmos recorded this" (neverRecorded). Both are
provably false when `sess.found` is true.

## Fix

Split the condition. When `sess.found && sess.contextUsed == null`, return
`notYetResult()` directly ("it has not done anything yet"). The `!sess.found`
path (a) and its gates — including the delicate cross-provider `notYetStarted`,
whose #2257 Claude-`.jsonl` residual is a separate known issue — are left
exactly as they were. The new guard fires ONLY when the rollout was found, so it
structurally cannot affect the match-miss case (path a).

This is the (b) fix the #2803 investigation flagged: "a working agent should
read notYet 'fills once it does something', never 'cannot find a transcript'."
It does not touch `notYetStarted`, so it cannot mis-fix path (a).

## Test

`engine/status.openai-ring-2257.test.js` gains a regression test: a found
rollout (`session_meta` cwd matches the workdir) with a window but no
`token_count` yet reads `notYet` and specifically NOT `NO_TRANSCRIPT` and NOT
`neverRecorded`. Verified it goes red without the fix (negative control:
without the guard the un-jobbed test agent routes to `neverRecorded`).

## Out of scope

- The `!sess.found` match-miss path and the #2257 Claude-`.jsonl` residual in
  `notYetStarted` (a Codex agent never writes a Claude transcript). Untouched.
- Copy wording of `notYetResult()` ("it has not done anything yet") — that is a
  design/jargon call, left as the existing shared-builder phrasing.
