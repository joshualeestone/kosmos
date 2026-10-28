# switchsay-7470: a saved-but-not-restarted switch says only what is true (#7470)

## Why
When a provider switch (POST /api/agent/<name>/provider) was saved but the restart did not happen, the answer said
"It is still running as before until it restarts." even of a stopped agent, and followed "We saved the switch to X"
with the restart's own "Nothing was changed." (#7470, found by review round 2 of #7455). The model switch had the same
shape ("It is still running the old one until it restarts.").

## Call
- The route stops claiming a running state. The restart's own reason (engine/remove.js restartSteps) already says it
  on every branch: not running, still running the older instructions, "if it is running...", or not running right now.
- After the reason, the answer says what puts the switch into effect: "Start or restart it from its card to put the
  switch into effect." (the model route: "...the new model into effect."). True on every platform: a job that stays
  loaded keeps its old arguments, so "when it next starts" would be false for an agent that comes back on its own, and a
  login or a Linux daemon-reload can also load the new ones, so nothing exclusive is claimed.
- The instruction, "Then it will run on ...", the #7455 conversation sentence and the OpenAI sign-in note are left out
  when a start from the card cannot help. restartSteps marks those returns with `cannotStart: true` (a launch file gone,
  a window it cannot tie to the agent, a job Kosmos did not start), so the route reads a flag, never the restart's words.
- "Nothing was changed." is one constant, removal.RESTART_CHANGED_NOTHING, which switchRestartWhy strips when it
  follows a saved switch; a reason without a closing full stop gets one; under dry-run the restart's text is left whole.

Rejected: a `running` field the route turns into words (the reasons already say it, and a second statement could
disagree with the first); "applies when it next starts" (false while the old job stays loaded); matching the restart's
words to decide what follows (review 3: fragile, the flag replaced it).
Weakest premise: every restartSteps failure return states the running state or that it cannot tell. Read and listed by
review rounds 1 and 4; a new failure return added later must keep that, or the answer goes quiet about it.

## Evidence
- server.switch-account-1373.test.js, route tests on the real board: a stopped agent (no "still running"; the
  instruction, the account and conversation sentences present as positive controls); a window that would not close
  (no "Nothing was changed"); the model route the same; a window it cannot tie to the agent (no instruction, account or
  conversation sentence); the restart's cannotStart flag for a job Kosmos did not start, with a control; the helpers'
  edge arms (full stop, bare ")", dry-run left whole, the flag).
- Every test file that imports server.js plus the restart, switch-route and test-file audit files: 323 files, 3855
  tests, 0 fail, after the rebase onto the rebased #7455.
- Mutants, each confirmed applied, the expected test red, restored from a copy: the old sentence back; the strip
  removed; the model route unstripped; the untied flag removed; the no-job flag removed.
- Not covered end to end: the launch-file-gone branch (the switch rewrites the job a moment before, so it is
  practically unreachable) and the sign-in-note gate (the fixture account is an API key); both are the same one-flag
  check as the tested branches.

## Review
- Round 1: W, "when it next starts" is false while launchd keeps the old job; W, the model route untested. Fixed.
- Round 2: W, "only Kosmos applies it" understates (login, daemon-reload): turned into an instruction. Nits taken.
- Round 3: BLOCKER, my export line put two existing exports inside a comment (server.task-roomrun-6894 failed): restored
  and every server-importing file run. W, tails after a refusal a start cannot fix; W, matching words: the cannotStart
  flag. Fixed with an end-to-end untied-window test.
- Round 4: the base was rebased under me: rebased, exports checked by name. W, the sign-in note after cannotStart:
  gated. Positive controls added; a vacuous assertion removed.
- Round 5: CONVERGED, no blocker or warning. Nit taken (a comment).
