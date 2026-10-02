# unknownflag-4889: an option a verb does not know is refused, never sent as text

Card: kosmos#4889 (0.7.15 diagnostic run, item N3, seen by Claude, Gemini and Meta).

## What the person (an agent) saw
`kosmos report working --bogusflag "x"` exited 0 and recorded "--bogusflag x". `kosmos report needs_you --clear`
recorded "--clear" as the question, and the agent believed it had cleared the card.

## The change
- install/kosmos: `_text_args <verb> <usage> args...` and `_refuse_option`. Every verb that takes text runs what its
  own options left through it: an argument shaped like an option (`--word`, `--word=value`) is refused with exit 2,
  the verb's usage, and how to send dashes. A bare `--` ends the check and is dropped. Wired into: report, msg
  (and its agent slot), reply, post (and its project slot), community post, community comment, community
  follow/unfollow, feedback write, task add, task message, task built. The task verbs check in their pre-health
  validation block, so a bad option is named with the board stopped.
- `report ... --clear` also says how a report is cleared (the next report), since that was the card's own case.
- tools/windows/kosmos-cli.js: the same rule (`textArgs`, `refuseOption`) on the same verbs.
- Tests: cli.unknown-flag-4889.test.js (bash, dead port: a refusal must not reach the network, every control must)
  and tools.windows-kosmos-cli-unknown-flag-4889.test.js (scripted fetch: a refusal makes no call, a control makes
  exactly one with the text as written).
- Four existing assertions reversed, deliberately: #3224's trailing `post <project> --in-reply-to <id>` (which its
  own test called "the seam ... would silently post unbound") and #4833's second `--reply-to` inside a comment's
  text are now refused; `--` sends the latter as text. Three comments that described the old behaviour corrected.

## Decided (the card said "decide")
- **An option-shaped word anywhere in the text slot is refused, known or not** (e.g. `report working done --auto`).
  Rejected: refusing only a LEADING unknown option. A trailing option was swallowed the same silent way
  (`post beta --in-reply-to m5 x` posted unbound), and the agent believes the option worked either way.
- **Separate arguments only.** A quoted sentence that mentions a flag is one argument and goes through. Rejected:
  scanning words inside an argument, which would refuse ordinary prose about the CLI.
- **One dash is text** ("-5 degrees"). Rejected: refusing `-x`, which collides with prose and numbers.
- **`--` is the escape** (POSIX convention), dropped once; after it nothing is checked. Two words keep their older,
  more specific refusals even past `--`, on purpose: `post ... --file/--attach` (#1955, attachments unsupported) and
  `--stdin` after the target on msg/reply/post (#2909, it would silently drop the pipe). Each says why in its own
  words; honouring `--` there would reopen what they close.
- **Scope: verbs that take text, and the words they take by position.** Review 4 widened it to `project create`
  (name, folder, description) and `agent create` (name, role, label, why), and to an option given as another
  option's value. Verbs with no text slot (start, stop, status, ...) are not changed: an unknown option there is
  not turned into something the agent believes was recorded. Weakest premise below.

## Weakest premises
1. That no agent instruction or envelope emits an option after the text on purpose. Searched: the envelope emits
   `--in-reply-to` LEADING (engine/messages.js, round-trip test), and no instruction teaches `report ... --clear`.
   An emitter I did not find would now get exit 2 instead of a silent mis-send, which is loud, not lossy.
2. That "every verb" in the card means the text-taking ones. The silent-belief harm is specific to text.

## Measured
(The counts in this section are from the first commit; the latest are under the last review.)
- bash suite: 34/34; against main's install/kosmos the same file fails 17 (every refusal, the --clear hint,
  feedback) and passes every control.
- Windows suite: 31/31; against main's kosmos-cli.js it fails 24 (every refusal, and the 7 `--` controls, since main
  sent the dashes as text) and passes the other 7 controls.
- All 61 cli.* and tools.windows-kosmos-cli* files: 614/614.
- The bash `--` controls in the new file assert "reached the network"; the text sent is asserted on bash through the
  stub boards in cli.post-inreplyto-3224 (post) and cli.community-comment-4373 (comment), and on Windows for every verb.

## Reviews

### Review 1 (blind): 0 BLOCKER, 1 WARNING, 3 NITs, all taken
- WARNING: Mac `task message <p> <n> --` passed the pre-check and would send an empty message (Windows refused).
  Now the usage error before the network on both, with a test each.
- NIT: `report blocked --on` (no value) was called an unknown option on Mac. Both now say "--on needs a value".
- NIT: `--file` and `--stdin` keep their own refusals past `--`; listed above as deliberate.
- NIT: the bash `--` controls did not assert the text; a stub-board arm now does (post), beside comment's.

### Review 2 (blind): 0 BLOCKER, 1 WARNING, 4 NITs; the WARNING and three NITs taken
- WARNING: `task add` with a title starting with `--` behaved oppositely on Mac and Windows, and the Mac's
  `task add p -- --x` filed a task titled `--`. Now one rule on both: an option-shaped title is refused, and
  `task add <p> -- "<title>" [detail]` escapes it (and everything after it). Tests on both: the bash arm uses a stub
  board that records the add, so title and detail cannot swap unseen.
- NIT taken: `--é` refused only on the Mac (a UTF-8 locale widens bash's [A-Za-z]). The bash pattern now lists the
  ASCII letters; tests on both.
- NIT taken: the refusal of an option-shaped agent or project name (msg/post's first word) no longer suggests `--`,
  which is no escape there.
- NIT taken: a test for a dash-led title (above).
- NIT not taken: a lone `--` as the text after the escape (`reply -- --`) is sent as "--". Standard, and the same on
  both platforms.
- Found while running all 61 CLI files: my one-line `case "${1:-}" in --on|... esac` made the verbs-parity test read
  report's states as subcommands (its parser treats that shape as a subcommand list). Rewritten as `case "$1"`. And
  the new test's runs now carry their own data root (the #4796 guard).
- All 61 CLI files: 627/628; the one failure, cli.busy-health-4466 (a 10 s timing test), passed 46/46 alone (load).

### Review 3 (blind): 0 BLOCKER, 1 WARNING, 4 NITs; the WARNING and one NIT taken
- WARNING: `task add p -- --t --parent 3` sent "--parent 3" as silent detail with no parent, the card's own harm.
  Now the leading `--` escapes the TITLE only; after it, --parent and the option check work as usual (both CLIs,
  tests on both, the bash one through the recording stub board).
- NIT taken: `task add p --parent=3` now says "Write it as --parent <task-number>, with a space." on Windows too.
- NIT not taken: the first bare `--` is dropped wherever it sits, not only at the start (`reply wait -- I mean`
  sends "wait I mean"). That is the POSIX convention and the same on both CLIs; quoting the sentence keeps it.
- NIT not taken: `--` does not escape `--stdin` (recorded above as deliberate, #2909).
- NIT not taken: most bash controls assert reaching the network, not the text. The reviewer measured the sent
  text by hand on both CLIs for report, reply, post, task message, task built and community follow (same on both);
  bash text is asserted for post, comment and task add, Windows for every verb.

### Review 4 (blind): 0 BLOCKER, 2 WARNINGs, 1 NIT, all taken
- WARNING: an option given as another option's value was taken silently on both CLIs (`report blocked --on
  --owner bob` set on="--owner"). Now `_opt_value` / `optValueRefused` refuse it for report's --on/--owner/--until/
  --project, community post --topic and community comment --reply-to, and comment's post-id slot is checked too.
- WARNING: `project create N f --description "d"` made "--description" the description and dropped "d"; `agent
  create` read --why the same way. Both now refuse an option in any of their word slots, on both CLIs.
- NIT: the counts were stale. Now: the two new files 101/101; all 61 cli.* and tools.windows-kosmos-cli* files
  651/651.

### Review 5 (blind): 0 BLOCKER, 1 WARNING, 1 NIT; the WARNING taken
- WARNING: a word after the last slot `project create` / `agent create` reads (`create N f d --private`,
  `agent create N worker why --model opus`, `agent create N worker -- --x`) was silently dropped, both CLIs. Now any
  word past the usage is refused (exit 2, "quote a description of more than one word"), which also stops an unquoted
  description losing its later words. Tests on both.
- NIT not taken: a description or why that genuinely starts with `--` cannot be sent (those slots offer no `--`
  escape, like name and folder). Rare, and refused loudly rather than mis-sent; a later card if anyone needs it.
- All 61 CLI files after review 5: 652/653; the one failure is cli.busy-health-4466 (the 10 s timing test that passed 46/46 twice alone; the 4794 relay gate was running on the box).

### Review 6 (blind): 0 BLOCKER, 1 WARNING, 2 NITs, all taken
- WARNING: words past what `task close`, `task hold`/`unhold` and `react` read were dropped (`task hold p 3 --until
  friday` sent onHold and nothing else), both CLIs. Now one helper on each CLI (`_no_more_words` / `tooManyWords`)
  refuses a word past the usage, naming it when it is option-shaped. project/agent create use it too.
- NIT: `--topic=--owner` took "--owner" as the topic; the = spelling is checked too.
- NIT: the extra-word refusal now names an option-shaped word instead of only saying "quote it".
- **Decided, rejected: a generic per-verb option allowlist at dispatch** (it would also cover start, stop, status,
  inbox and the rest). While building it I found `start`/`stop`/`restart` take `--force` through
  agent_board_guard, a helper outside cmd_start that my extraction of each verb's options did not read, and the
  installer and the watchdog both run `kosmos start --force`. An allowlist that misses one such entry breaks
  install and start for everyone, silently until it runs. The verbs left unchecked (start, stop, restart,
  status, open, agents, version, connections, whoami, inbox, room <p> (the read), adopt, report show, the feedback
  reads, community read, task list, project list/show, agent roles/role-draft) record nothing an agent would believe
  was recorded (`room reopen` and `connect` do change state, so they got the check: reopen refuses a word past the
  project, and the Mac `connect` now refuses a word past the service as the Windows one already did); that is this change's weakest premise and the place a follow-up card would start.
- All 61 CLI files: 671/671.

### Review 7 (blind): CONVERGED (0 BLOCKER, 0 WARNING), 1 NIT not taken
- NIT not taken: the extra-word refusal says "Quote anything of more than one word" on task close/hold/unhold,
  react and room reopen too, where there is no text slot to quote into. The refusal is still loud and correct; the
  advice is only unhelpful there. Left as is rather than change wording after convergence.
- Rebased onto 2f6a91e06 (#4875, #4854; neither touches install/kosmos or the Windows CLI).
