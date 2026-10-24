# #7030: the native Today tab (iPhone slice 4)

Spec: Mona Lisa, 2026-10-24, on #6838 (comment 6381560811). Two parts, each its own PR.

## Part 1 (this branch first): the Mac sends Today's reason and project name ready-made

### Finished looks like
- Every `/api/status` agent row whose `cardTone` is `asked` or `needs_you` carries `needsReason`, one of:
  `question`, `permission`, `trust`, `gave_up`, `crash_loop`, `stuck_auth`, `stuck_rate`, `own_bound`, `other`.
  Any other row carries none.
- A row with `stateProject` naming a project the Mac knows carries `stateProjectName` (that project's name).
- Server tests on a fake fleet classified by the real engine: each reason, the precedence cases, no reason on a quiet
  or working row, the project name present and absent (unknown id, unreadable projects file).

### Approach
- `engine/cardlabel.js reasonOf(a, needsPerson)`: null unless toneOf is asked or needs_you. A `needs_you` state is
  `permission` when `awaitingApproval`, else `question`. Otherwise the engine's own `projects.needsYouReason(a, null)`
  (its needs_you branch is already handled above), and `other` when it has no specific reason (a stopped agent, a
  rate limit the engine does not count as stuck, a state added later).
- `server.js withCardWords(rows, projectList)`: adds both fields. The status route reads the projects file once and
  shares it with the existing unread count (no second read per tick). An unreadable file means no names, never a
  failed status read.

### Rejected
- The phone working the reason out from raw fields: the spec asks for it ready-made, as slice 2 did for the word, so
  the phone never keeps a second copy of the engine's rule.
- Sending the sentence instead of a code: the phone shows the same sentence in a few places and its own sizes; a code
  is the stable contract, and the sentences are the board's PJ_NEEDS_WHY words, pinned by a test on the phone side.

### Weakest premise
That `needsYouReason`'s specific reasons (written for a project's needs-you block) are the right words for Today too.
Its `other` and the spec's "anything else" line up; the one addition is `permission`, which the board's block lacks
(its card word is "Needs permission"), as the spec says.

## Part 2: the phone's Today screen
Per the spec: three sections each hidden when empty, the badge from `counts.waiting`, a signed-in launch opens on
Today, Answer/Open into the native chat, Check it into the task page in the board view. Design shots to Mona Lisa.

## Ruled
- stuck_rate stays its own reason with the board's PJ_NEEDS_WHY words and Open (Mona Lisa, 2026-10-24 02:45 CDT):
  #6341 keeps out-of-usage off a PROJECT, Today is per agent, so folding it into "other" would hide a reason the board
  can name. Her spec table is updated.

## Review round 1
- Fixed (blocker, measured by the reviewer on real rows): needsYouReason requires `present` and `tied`, which only
  project member rows carry, so on real /api/status rows every reason but question and permission was 'other'. A
  status row is now present by being listed and tied by isNamedOurs, as tasks.js waitingOnOf reads it.
- Fixed (blocker, tests): the hand-built cards supplied that premise. Every reason test now starts from a real status
  row, with a premise test that real rows carry no present/tied and are isNamedOurs (it goes stale loudly if that
  changes). Mutants: dropping the fix, or tying a card the board does not call ours, both go red.
- Fixed (major): a failed restart (a needs_you row with no question behind it) read as a question. New code
  'restart_failed', board words "Kosmos restarted it, and it did not come back." (pjAlsoWhy), Open.
- Fixed (major): the board's order. Failed restart, crash loop, offline trust, then the needs_you state, so the sentence
  never contradicts the card's word ("Keeps stopping"). An agent-reported wait reads Question even on a permission
  prompt, as labelOf words it.
- Fixed (minor): needsYouReasonPastUsage, so a rate limit never hides a real reason.
- Fixed (minor, existing since #7004): an offline card on its trust prompt had a quiet tone, so it would never reach
  Today; its tone is now needs_you and its reason 'trust'. This also turns it red in the phone's Agents list.
- Decided: a needs_you read off the screen with no reporter and no permission prompt is 'question' ("Waiting for your
  answer.", Answer). The chat draws that screen's question with buttons (slice 3b), so Answer leads somewhere true.

## Review round 2
- CORRECTION of round 1's last fix: an offline card on its trust prompt was never quiet. The route gives it needsTrust
  only together with state needs_trust, which needsPerson counts, so it was already needs_you and already red in the
  Agents list. My tone branch only matched an idle row nobody builds; removed, with a premise test of the real shape.
  (Mona Lisa told the same night: nothing in the Agents list changes.)
- Fixed (minor): offline trust is checked before a crash loop, matching labelOf's word and the engine's order; test on
  the route's real offline shape with a loop.
- Fixed (minor): every listed row is tied (the tie gate credits a wait to a project, which Today does not do), so an
  untied pane whose reconnect gave up reads gave_up, not other.
- Fixed (minor): the route test pins sol and rae as 'other'; the unreadable-projects test checks the read really fails.
- Decided again, flagged for Mona Lisa: a needs_you read off the screen that is not a permission prompt and not reported
  by the agent stays 'question'. The reviewer notes it also covers Codex hook screens and the safeguards menu, which are
  not questions; the board's own sentence for an unattributed needs-you is "Waiting for you. It did not say which
  project." Her call on the wording.

## Review round 3 (converged: minors only)
- Ruled (Mona Lisa, 10-24 02:54): a needs_you read off the screen with no agent report and no permission prompt is
  'waiting', "Waiting for you. Open it to see what it shows." with Open (the board's own_bound words for a screen it
  cannot name). The agent's own question keeps "Waiting for your answer." with Answer. Done, with a mutant.
- Decided: a card that is not running and keeps crashing reads "Not running" with the crash-loop sentence, which says
  why; pinned in a test on the route's offline shape.
- Not changed: stateProjectName through the route. The fake fleet cannot give a row a stateProject (it comes from the
  agent's own report), so the route's use of the projects read is pinned by source (server.statusword-7004) and the
  name logic by withCardWords directly, with the unreadable path through the route.
