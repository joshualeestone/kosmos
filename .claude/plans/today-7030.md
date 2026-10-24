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
