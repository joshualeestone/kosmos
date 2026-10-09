# kosmos#5683 slice 1, board half (part 1a): refused agent actions to the company

Josh 2026-10-09 08:38 (the card), 08:41 (the company owns work content: an event may reference the conversation),
08:43 (every Kosmos on a work computer is the company's). Relay half: kosmos-relay agentevents-5683
(`POST /v1/mac/org/agent-events`, table org_agent_events, apart from org_audit per Pete's #5529 replan).

## What changes
- `engine/agentevents.js`: every 5 minutes (server.js agentEventsTick, the rollup's gates: live execution, enrolled
  here), the enrolled Kosmos with consent recorded (orgenroll.mayReport) reads its TOKEN-ONLY agents' new transcript
  lines (per-file byte offsets, complete lines only, at most 4 MB a file a tick) and queues refusals by the company's
  own rules; it sends at most 50 a tick, Mac-signed; a failed send keeps them (at most 500, for 7 days less an hour).
- What counts: an error tool result "Permission to use <Tool> ... has been denied." (the token-only guard's deny rules;
  measured text, Claude Code 2.1.295) and a Bash error with "Operation not permitted" (its sandbox).
- An event: world, agent, at (seconds), action (run/write/read/network from the tool), rule, targetClass (one of
  board-files, agent-config, other-agent, home, system, network-host, other), sessionRef (the transcript's session id),
  toolUseRef. Never a command, a path or any text.
- `engine/receipt.js` exports its transcript-folder helpers (one rule for where transcripts are).
- `tools/test-connector-verbs.sh`: the macRequest caller pin re-decided for the new caller.

## Decided (overturn in one line)
- Only token-only agents are read: they are the agents the company's rules (the guard and its sandbox) apply to. A
  person's own deny rules on any other agent, and the auto-mode classifier, are never read or sent. On a token-only
  agent the guard shares its deny list with the person's own rules and the refusal text is the same, so a refusal by
  the person's own rule there is reported as the guard's (review 6). WEAKEST PREMISES: this, and the EPERM text match.
- Nothing from before the enrollment, the current accepted words, or the agent joining the token-only list: each is a
  time an event must be at or after (compared in milliseconds since review 18). A transcript first seen is read from its start only if written
  after that time; an older one is skipped to its end unread.
- The PermissionDenied hook is not used: it fires only for the auto-mode classifier (measured), so it cannot see a
  deny-rule refusal.

## Not in part 1a (stated)
- Part 1b: the other Kosmoses on the same computer (Josh 08:43). The relay already accepts any world on the enrolled
  computer; the board needs each world's roster, token-only list and id.
- Org-policy refusals: no agent action is refused by org policy today (policy pushes settings); the rule value exists
  for when one is.
- Other providers (Codex, Gemini, Grok): their refusal text is not measured; Claude only.
- The sandbox match is by text: a Bash command whose own output says "Operation not permitted" for another reason
  (an EPERM unrelated to the Kosmos profile) on a token-only agent is reported as a sandbox refusal. Weakest premise.
- The consent words do not yet name these events; they ship with Pete's consent change (#5685).

## Review 1 (sonnet), all fixed unless stated
- A line over the 4 MB read window wedged its file: now skipped (its tail reads as one unparseable line). Test, P5.
- A call and its result in different ticks lost the tool (a sandbox refusal was missed): tool uses kept in memory per
  file across ticks (bounded; lost on a restart, then classified from the denial text). Tick-level test, P6.
- No upper bound on an event's time (the coordinator skips such an event and counts it): events over 5 min ahead are not queued, and a
  queued event is dropped an hour before the coordinator's 7-day limit. Test, P8.
- Consent: a 409 org_consent_changed stops the sends (orgenroll.consentWithdrawn), not_enrolled/not_member refresh,
  as the rollup. The state is keyed on the accepted consent hash too: words accepted again start clean and send
  nothing from before that moment. Test, P9.
- Paths resolved before classifying (agentDir/../.. reached the board's files as 'other'); ~user is 'other'; only
  <agentDir>/.claude/ is agent-config. Test, P7.
- No readable enrollment time sends nothing (it failed open). Test, P10.
- A subagent's transcript references its parent session. Test, P11.
- Every transcript is read from its start the first time (then filtered by time); offsets of transcripts that are gone
  are dropped. (Superseded by review 2: an agent counts from the first tick that saw it listed.)
- The computer print is sent as the rollup sends it (the coordinator now checks it, relay review 1).
- The label check is written with escapes (no raw bidi character in the source; the test's one fixed in review 4) and
  refuses zero-width characters.

## Review 2 (opus), all fixed unless stated
- An agent made token-only after joining had its older refusals (the PERSON's own rules) sent: each agent's first
  sighting on the list is recorded, and nothing before it is sent. An agent already listed when the state began counts
  from that first tick (the list keeps no history): the private side, at the cost of refusals between joining and the
  first tick. Test, P12.
- The call map kept full tool inputs (a Write's content) and successful results never freed them: it keeps the name and
  the target class only, and any result forgets its call. Test, P13, P17.
- The first tick read every old transcript synchronously: a transcript written before the time that counts is skipped
  unread, and a tick reads at most 16 MB across all transcripts. Test, P14.
- Consent and the enrollment are re-checked after the scan, before the send (the rollup's review 3). Test, P15.
- A failed send waits 30 minutes before the next (no signed request and refresh every five minutes). Test, P16.
- The consent-gap test now proves a refusal after the words are accepted again IS sent; too_big drop and the
  not_enrolled refresh are tested.
- Relative paths resolve against the agent's folder; a Bash curl/wget/nc/ssh/scp to a URL is network-host; the
  coordinator's capped/skipped counts are logged.
- Stated: words accepted again count from the tick that sees them (a refusal between the acceptance and that tick, at
  most one tick, is not sent). org_bad_print is not dropped: it is a board defect, and the 30-minute wait bounds it.

## Review 3 (sonnet), all fixed
- A torn read of the token-only list (an empty list) wiped every agent's first sighting: the board's source answers
  null when the file exists but cannot be read, and the tick then changes nothing. Test through the board's own
  sources, P19.
- A Bash target was its FIRST path (usually the binary or a cd): every path in the command is classed and the most
  telling one reported (board-files, agent-config, other-agent, home, system, other). Test, P18.
- Too big with more than one event dropped good events: the next send carries half as many (reset after a success);
  a single event too big is dropped. Test, P20.
- Words withdrawn and accepted again under the SAME hash kept the old queue and the gap: the withdrawal is recorded in
  the state and the resumed tick starts clean. Test with a positive arm (a refusal after the words are back IS sent),
  P21. The consent path also sets the 30-minute wait.
- A recently written transcript holding old lines exercises the time filter itself (the mtime skip could hide it).
  Test, P22. A non-finite first-sighting time fails closed.

## Review 4 (opus), all fixed unless stated
- A withdrawal whose record write failed reset the state (and its wait) on the next tick, so it sent every tick: the
  withdrawn flag is set only when consentWithdrawn recorded the change. Test.
- A relative traversal in a Bash command (../../Library/Kosmos) read as 'other': ./ and ../ paths are classed too.
  Test. A resolved path outside every known folder is 'system'.
- The torn-read fix read the list twice (a write between could still wipe first sightings): one read, one parse.
- An offset is dropped only when its file is gone (a listing failing for a moment no longer re-reads every session).
  Test. The read budget is a real cap (each read takes at most what is left).
- The one-hour margin before 7 days is tested; labels refuse the invisible characters the relay now refuses (relay
  review 4). Test.
- Stated: a refused tool not in the action table (an MCP tool, Task) is reported as 'run'; PENDING_MAX trimming is
  untested.

## Review 5 (sonnet), all fixed unless stated
- A sandbox refusal whose call was lost (a restart between the call and its result) was dropped: an "Operation not
  permitted" result with no known call is taken as Bash (the EPERM premise already stated). Test.
- A rewritten file's reset offset made the budget grow: the budget counts the bytes actually read. Test.
- Every transcript ever seen was opened every tick: a file whose size has not changed is only stat'ed. Test.
- The budget was spent in directory order (one large backlog could starve other agents' files): the agent read first
  rotates each tick (delays, never losses).
- Decided and commented: a network command is network-host before the paths it names.
- Stated: other-agent covers other token-only agents' folders only (the scan knows no other agent's folder); a refusal
  aimed at another, non-token-only agent's folder reports 'home'.

## Review 6 (opus), all fixed unless stated
- Bash paths with a space were cut at the space (the board's own folder is under "Application Support"), and $HOME
  paths were not seen: a linear shell-word split (quotes, backslash escapes), $HOME/${HOME} as ~, and curl's @file.
  Test.
- Stated, not fixed: on a token-only agent the person's own deny rules share the guard's list and its refusal text, so
  a refusal by the person's own rule is reported as the guard's. Telling them apart needs matching Claude Code's rule
  syntax against the guard's recorded rules; the plan and the module doc now say so (it was claimed never to happen).
- A session first seen in the tick its agent was listed (or words accepted) starts at its end, not byte 0.
- After a halving, the smaller send size is kept until the backlog drains (no too-big every other tick).
- A long agent name keeps 120 characters and a short hash of the whole name (two names no longer merge). Test.
- The test that pinned `curl -d @~/secrets` as 'other' now expects 'home'.

## Review 7 (sonnet), all fixed unless stated
- A bare relative path in Bash (`cat .claude/settings.json`) was not taken as a path: dotted names and any word with a
  slash (not a URL) are, resolved against the agent's folder. Test.
- label() matches the coordinator again: blank values and the invisible fillers are refused. Test.
- Stated: every tool use is classed as it is read (a refusal is rare, so classing lazily would save the work), because
  classing lazily means keeping part of the input, which the call map deliberately never does; the cost is bounded by
  the read budget. A Mac clock over 5 minutes ahead loses fresh events (the coordinator skips them). Offsets of an
  agent taken off the list stay while its files exist (read and filtered away if it is listed again). The timing test
  bounds targetClass as a whole, which slices the command first; the regex bound itself is not isolated.

## Review 8 (opus), all fixed unless stated
- /dev/null and the program itself counted as targets (so `cat ./x 2>/dev/null` read as 'system'): the first word of
  each command and /dev/* are skipped. Test.
- Paths were compared case-sensitively on a case-blind Mac volume (~/library/kosmos missed the board's files): on a
  Mac the comparison folds case. Test (darwin).
- The agent rotation and the kept send size after a halving are tested. Stated: the 16 MB per-tick budget is not
  tested (it needs fixtures over 16 MB); PENDING_MAX trimming is untested.
- The module doc names scanText (not pure: it updates the call map); crypto is required once; the plan's queue line
  says 7 days less an hour.
- (With relay review 7) the two references are ids only: 1 to 128 of [A-Za-z0-9_-], as the coordinator now requires;
  an event whose session or tool use id is not one is not sent. Test.
- The kept-size test uses a backlog of 6, so the size going back up would show (with 4 it could not). P39.

## Review 9 (sonnet), all fixed unless stated
- agent-config was case-sensitive under the case-blind fold: the relative test folds too. Test (darwin).
- A path inside a shell wrapper (bash -c "...", python -c '...') read as 'other': a quoted argument holding spaces is
  split once more. Test.
- `\bssh\b` matched ~/.ssh, relabelling a private-key read as network: a network command is the PROGRAM word (curl,
  wget, nc, ncat, ssh, scp, sftp, rsync) with a URL among the words; the old regex is gone (still linear). Test.
- The state was rewritten every tick: the rotation counter lives in memory, and the state is written only when it
  changed. Test.
- A newline ends a command (the program on a second line is not a target). Test. The module doc says a tool's own
  output that starts with the refusal text is read as one (bounded by the fixed classes).
- Stated: Windows-style paths in a Bash command are mangled by the backslash escape, and case folding is darwin-only.

## Review 10 (opus), all fixed unless stated
- Claude Code flattens an agent's folder into its project folder name, so orch.main (token-only) and orch-main (not)
  share transcripts, and the second's refusals by the PERSON's own rules would go to the company as the first's: a
  token-only agent whose transcript folder collides with a non-token-only agent's is not read, and nothing is read
  when the agent list (register.survey) cannot be read. Fails closed. Test.
- ssh, scp, sftp, nc and ncat never take a URL, so they could not be network: they are network by themselves; curl and
  wget need a URL; rsync needs a remote host: word. Test (a local rsync is not network).
- The rotation test asserts that the second tick reverses the first (the starting turn is module-wide).
- A duplicated comment removed.
- Stated: after a restart, an error result with "Operation not permitted" and no known call is taken as Bash (a Read
  error with that text would be read as a sandbox refusal); each tick lists and stats every token-only agent's
  transcripts (bounded by the session count).

## Review 11 (sonnet), all fixed unless stated
- The collision check left out an agent whose folder could not be resolved (a stray with an unusable name), failing
  open: such an agent makes the check unreadable, and nothing is read. Test.
- A wrapped program (sudo, env K=V, timeout N, nice, nohup, command, xargs, time, exec, doas) hid a network command,
  and git to a URL was not network: the word after a wrapper (past its options, K=V words and a duration) is the
  program; git with a URL is network. Test (git status is not).
- A joined short option (tar -C/dir, -I/path) is a path. Test.
- Stated: a quoted word with a slash and no space (application/json, s/a/b/) is taken as a path; it classes 'other',
  the lowest rank, so it cannot raise a class.

## Review 12 (opus), all fixed unless stated
- When a transcript-folder collision cleared (the other agent deleted), the shared folder's past was read from byte 0
  and the other agent's refusals went out as this one's: the collided agents are recorded, and one whose collision just
  cleared counts from that tick (its files start at their end). Test.
- The collision check was optional (a missing source read as "no clash"): both sources are required; without them
  nothing is read. Test.
- Stated: create.workerDir never returns null for a refused name (it returns a placeholder path), so the review-11
  "cannot be resolved" arm fires only for a dirOf that throws; a clock set back holds failAt/listed in the future
  (a loss until the clock catches up, never a leak); Glob/Grep with an absolute pattern and no path class 'other'
  (whether Claude Code checks the pattern is unmeasured); two token-only agents colliding with each other attribute to
  whichever is read first (both under the company's rules).

## Review 13 (sonnet), all fixed unless stated
- board-files was only this store, narrower than what the guard denies: it is every root the guard denies
  (setup-assistant.tokenOnlyTokenRoots, now exported: this store, the legacy roots, the default world's base, every
  named world's store) and the installed app. agent-config adds the agent's CLAUDE.md, .mcp.json and AGENTS.md and
  the account's Claude config folders (status.configRoots). Best effort: a lookup that throws narrows the classes,
  never the reading. Test.
- Stated (NITs): `world` is the enrollment's own id (not re-checked here; the coordinator skips a malformed one);
  capped and skipped answers count as sent (logged); a busy local macRequest answer waits the 30 minutes as a failure
  does; the timing test is a wall-clock bound (100 ms against a measured 3.7 s regression).

## Review 14 (opus), all fixed unless stated
- BLOCKER (introduced by review 13's fix): in a named world the guard's roots include the default world's BASE, which
  contains every agent's folder, so nearly every refusal read as board-files (and the agent's own config too). A board
  root that contains the agent's own folder is ignored (a base, not a store), and the agent's own folder and the other
  agents' are classed before the board's roots. Test with a named-world layout.
- A leading K=V assignment (FOO=1 curl https://x) is skipped to find the program. Test. The scanText doc lists the ctx
  fields.
- Stated (WARNING, a privacy premise): a person who runs `claude` themselves in a token-only agent's folder writes into
  the same transcript folder, and their sessions are read as the agent's (the collision check knows only Kosmos's own
  agents); their refusals there would go to the company with a session reference. A third weakest premise, beside the
  shared deny list and the sandbox text match. Recorded on the card.
- Stated: each tick runs register.survey and the config-roots lookups (on the enrolled board, every five minutes);
  the case-folding tests run on darwin only.

## Review 15 (sonnet), all fixed unless stated
- In a named world the dropped default-world base still holds its own board files directly (board.token, undo.json, the
  worlds registry): a path directly under such a base, outside its worlds/ folder, is board-files. Test.
- A tick yields to the event loop after each transcript (the read and parse are synchronous).
- A first tick a minute after start (server.js), as the rollup has, so a session started right after joining is not
  skipped to its end for want of a tick.
- readState's fallback returns every field.
- Stated: the call map keeps a bounded map per transcript seen, freed when the file is gone.

## Review 16 (opus), all fixed unless stated
- On the token-only list is not under the company's rules: setup-assistant refuses to write the guard when a root is
  missed, a rule is dropped, on Windows, or for a non-Claude runner, and a just-listed agent runs unguarded until its
  settings carry the rules. Such an agent's refusals are all the PERSON's own. Only an agent whose own settings hold
  every rule the guard writes for its folder (tokenOnlySettingsRules, now exported; nothing missed or dropped) is read;
  the check is a required source. Test.
- A sandbox refusal counts only on macOS (no sandbox is written elsewhere). Test.
- A tool name from denial text that is an object key (constructor) is a 'run', never an inherited value. Test.
- Stated: a settings file that holds the rules does not prove the RUNNING session started with them (a session started
  before the guard was written reads its old settings until it restarts); a non-token-only twin created and deleted
  within one tick is never recorded as a collision; home falls back to os.homedir() where the guard uses kosmosHome().

## Review 17 (sonnet), all fixed unless stated
- The real guard check was never tested, and it compared every rule, including launch rules built from the board's own
  PATH, so a guard written at a launch from another pane's PATH read as missing and the feature could go silent: it
  checks the rules that keep the board token out (they follow from the token roots), logs once per agent it skips, and
  a test writes a guard with guardTokenOnlyFolder (now exported) and checks the board reads it as guarded (and an
  unguarded folder as not).
- The guard check re-ran the launch-path scan per agent per tick: one shared launch cache per tick.
- Words lost without a 409 here (the rollup's 409, a refresh) left the state unmarked, so words accepted again under
  the same hash would send the gap: while enrolled with no words accepted, the state is marked withdrawn. Test.
- Stated: the guard check reads the deny rules, not the sandbox block; a failed state write after a read degrades the
  next read's target classes (the coordinator dedupes the repeat).

## Review 18 (opus), all fixed unless stated
- The collision check compared only against agents OFF the token-only list, but since review 16 a listed agent whose
  guard is not in force runs under the person's own rules: the guard pass runs first, and those agents count among
  the others a read agent must not share a transcript folder with. Test (two colliding listed agents, one unguarded).
- The guard round-trip test fails on a Mac when the guard cannot be written (it skipped, which could never fail).
- The words-lost test proves a refusal in the gap is not sent and one after re-acceptance is.
- Time bounds are compared in milliseconds (an event a fraction of a second before a boundary no longer counts); the
  time sent stays in whole seconds.
- Stated: a failed state re-read after a send writes the fallback over the queue (a loss, never a leak; listed resets).

## Review 19 (sonnet), all fixed unless stated
- A path a glob, a variable or a substitution hides (App*, $KOSMOS_DATA) could not be resolved, so a refusal at the
  board token read 'home' or 'other': a Bash command that names the board token, Kosmos's own folder, the token-only
  list or the worlds registry is board-files; one naming .claude, CLAUDE.md or .mcp.json is agent-config. Test.
- A wrapper option that takes a value (sudo -u bob) took the value as the program; git@host:repo was not remote: both
  understood. Test.
- The denial test ran one regex over the whole result: it tests the head and the tail only. Test (linear, and a result
  that does not END with the denial is not one).
- Nothing queued is kept on disk once the words are withdrawn (both paths).
- The duplicate guardTokenOnlyFolder export key removed; the r16 and r18 tests have positive arms.
- Stated: a path under a dropped base outside worlds/ is board-files even for a non-token-only agent's folder there
  (over-claims, hides nothing); `world` is the enrollment's own id, unchecked here.

## Review 20 (opus), all fixed unless stated
- The review-19 hint matched the whole command, so in a named world (whose agent folders sit under
  Application Support/Kosmos) an agent's own file read as the board's: the hint looks only at the words a glob, a
  variable or a substitution hides. Test with the named-world layout.
- A garbled comment on TURN / UNGUARDED_SAID; the Decided time-bounds line says milliseconds.
- Stated: after a Leave the ticks stop (isEnrolledHere), so the old queue stays on disk until the next enrollment resets
  it (nothing is ever sent from it); a file truncated and then grown past its old offset misses its new lines up to it;
  a file read before a collision resumes from its old offset (the millisecond filter keeps that from leaking).

## Review 21 (sonnet), all fixed unless stated
- One agent whose transcripts could not be listed ended every tick (silently): that agent is skipped and logged once;
  a transcript folder that cannot be worked out in the collision check still reads nothing (it cannot be compared),
  and is logged. Test.
- The hidden-path hint's anchored pattern was tested on all hidden words joined (a later hidden word hid it): each
  hidden word is tested on its own. Test.
- Correction to review 14's note: a dropped base's own files (outside worlds/) are classed before the other agents'
  folders; no known layout puts an agent folder there (the default world's workers sit outside the base), so this can
  only over-claim, never hide.

## Review 22 (opus), all fixed unless stated
- The guard check required every world's concrete token rule, so creating a named world made every agent read as
  unguarded until it relaunched (though the guard's worlds glob covers that store): it requires this board's own
  store's token rules. An agent guarded again is said again if it later lapses.
- Four tests expected a sandbox event from the platform default and failed off macOS: the test context and ticks say
  darwin (the tick takes a platform for tests).
- The module doc says listed AND guard in force.
- Stated: words lost without a 409 here and the same words accepted again within one tick (no tick sees the gap)
  could send that few minutes' refusals; a listed agent whose dirOf returns null is skipped in the collision check
  (dirOf never returns null in production).
- Untested (stated): the new-named-world case itself (it needs a world registry made after the guard is written); the
  round-trip test pins that the narrowed check still reads a real guard as guarded and an unguarded folder as not.

## Review 23 (sonnet), all fixed unless stated
- A failed state write after a scan had already consumed those lines' calls, so the re-read was classed without its
  target (which most hurts board-files): the scan works on copies of the call maps, kept only once the state is
  written. Test (the state folder made unwritable for one tick).
- Stated: a line over 4 MB is skipped unread, so a refusal inside such a line is lost (a miss, not a leak); a bare
  relative filename with no slash or dot prefix (cat board.token after a relative cd) is not taken as a path.
- The orphaned review-11 comment sits above its code; the module header says scanText is not pure.

## Review 24 (opus), all fixed unless stated
- A guard that lapsed and was rewritten while the board was down was never seen lapsed, so the gap's refusals (the
  person's own) were read under the old start: each agent's last guard confirmation is recorded, and one unconfirmed
  for over two ticks (11 minutes) counts from now. The downtime's refusals are lost (the private side). Test.
- The hidden-path hint matched worlds.json/board.token anywhere (an agent's ./maps/*/worlds.json read as the board's):
  a hidden word whose fixed start resolves inside the agent's own folder is dropped from the hint. Test.
- Offsets read from the state file must be non-negative numbers (a corrupt one no longer stops a file for good).
- Stated: a brief misread of the world-id file can mark the state withdrawn and clear the queue (a loss, never a leak);
  tokenOnlySettingsRules' own stderr line repeats each tick for a folder with a pattern character; the r23 test
  cannot fail when run as root; the plan's "What changes" omits the setup-assistant exports (tokenOnlyTokenRoots,
  kosmosHome, tokenOnlySettingsRules, guardTokenOnlyFolder), named here.

## Review 25 (sonnet), all fixed unless stated
- A command was classed only on its first 4096 characters (padding hid a token read past them): past that, the board
  token's or the token-only list's exact file name anywhere in the command (up to 1 MB, one linear search) is
  board-files. Test.
- The guard confirmation refreshed at 4 minutes, so every five-minute tick rewrote the state: it refreshes at half
  the gap (5.5 minutes), every other tick. Test with ticks five minutes apart.
- The two wall-clock timing tests: one widened to 2 s (the regression measured 3.7 s), the other has no time bound.
- $PWD, ${PWD} and $(pwd) are the agent's own folder in the hidden-path hint. Test. The constants' comments are each
  on their own line.
- Stated: git without a URL is not network-host; a board program run as the program word is not a target; a relative
  path resolves against the agent's folder though the shell may have cd'd elsewhere; a gap and a collision in one tick
  keeps the collision only until the next tick.

## Review 26 (opus), all fixed unless stated
- With the confirmation refreshed only at half the gap (review 25), it could be ~10 minutes stale while checked, so an
  11-minute gap fired after ONE missed tick (a slow tick, a paused board, a restart): the gap is 20 minutes (that
  staleness plus two missed ticks and a margin); the comments and this note say so (review 24's "two ticks" was stale).
  Test (one missed tick keeps the refusal).
- A bare relative glob with no fixed start (star/worlds.json) skipped the own-folder filter and read as the board's:
  a word with no fixed start that does not begin with a variable is the agent's own. Own-folder paths fold case on a
  Mac. Test.
- Confirmations are pruned when an agent leaves the list; the review-24 test has a positive arm.
- Stated: past 4096 characters, a file named exactly board.token inside the agent's own folder reads as the board's.

## Review 27 (sonnet), all fixed unless stated
- The review-26 "margin" did not exist: refreshing at half of 20 minutes lets the confirmation be 15 minutes old at an
  ordinary check, so one missed tick reached the gap exactly. The gap is 30 minutes and the confirmation refreshes at
  10 (writes every third tick); an ordinary check sees at most 15, two missed ticks 25. Test at the worst case (checks
  at 5 and 10 minutes, then 25 and a few seconds).
- Stated: path classing resolves, it does not follow symlinks (a link the agent made to the board's files reads 'other';
  making the link is itself a write in its own folder); a line larger than the tick's remaining budget waits a tick.

## Review 28 (opus), all fixed unless stated
- A guard gap and a collision in the same tick erased the collision mark, so once the other agent was deleted its
  sessions were read as this agent's: the gap clears only a gap-only mark. Test.
- The collision check compared flattened transcript folders case-sensitively, but a Mac volume is case-blind
  (Orch.Main and orch_main flatten to one folder): it folds case on a Mac. Test (darwin).
- An agent connected at the home folder or ~/Library contained the store, so its own-folder branch hid every
  board-files refusal: a board root inside the agent's folder is checked first. Test.
- A reset state lists every field.
- Stated: the guard gap is wall-clock time, so a laptop asleep for over the gap also starts its agents from now (a loss,
  never a leak, and more frequent than a board left down); a hidden word starting with another variable ($MYDIR) is
  not dropped as the agent's own (over-claims).

## Review 29 (sonnet), all fixed unless stated
- Two token-only agents sharing one transcript folder were both read, and a file's events took whichever name the
  rotation read first: a folder shared by two read agents is a collision too, so neither is read. Test.
- Review 25's note on the refresh interval is marked superseded (review 27 set GUARD_REFRESH_MS, 10 minutes).
- Stated: a tool_use line over READ_MAX is skipped, so a refusal of that call is classed 'other'; an agent taken off
  the list keeps its offsets and call maps until its files go (ids and classes only, never sent); an unexpected throw
  in a tick returns its text, which the server's timer drops (as nothing else reads it in part 1a); "Operation not
  permitted" also matches TCC/SIP refusals (the stated text-match premise).

## Review 30 (opus), all fixed unless stated
- Inside double quotes a backslash was dropped before any character, so bash -c "cat ~/Library/Application\ Support/
  Kosmos/board.token" split at the space and read as home: it now escapes only $, a backtick, ", \ and a newline, as
  in bash. Test.
- With an agent connected at the home folder, a hidden word toward the board root (Kosmo?/board.token) was dropped as
  the agent's own before the name check saw it: a word whose fixed start resolves at, under or toward a board root
  inside the agent's folder is kept. Test.
- A whole quoted command starting with / (sh -c "/usr/bin/true; cat notes.txt") was kept as one path and read as
  system: a quoted word holding ; | & or a newline is not a path. Test.
- Stated: a quoted command with no separator (sh -c "/usr/bin/tool arg") is still kept whole as a path and can read
  as system (it can only raise the class to system); "\$HOME/x" is read as home though bash prints it literally
  (over-claims); a hidden word with no board name in it (Kos*/b*) is kept but not classed board-files.

## Review 31 (sonnet), all fixed unless stated
- A backslash-newline (a line continuation, which bash deletes) was kept as a newline, so board.\<newline>token read
  as other, quoted or not: it is dropped in both. Test.
- Review 30's skip of a whole quoted command also skipped a quoted path through a folder with & or ; in its name
  ("Tom & Jerry"), reading a token read as other: the word is skipped only when, whole, it is not the board's files or
  the agent's config. Test.
- Review 30's toBoard compared string prefixes, so ./star/worlds.json at the home folder read as the board's: the word's
  segments, as globs, must match every segment of a board root; a segment with a variable keeps it. Test.

## How each round is checked (written here so a restart does not have to reconstruct it)
    node --test engine/agentevents-5683.test.js                     # the board file
    node --test engine.*.test.js engine/agentevents-5683.test.js    # engine guards + board (260 at review 30)
    bash tools/test-connector-verbs.sh                              # the connector caller list
    git diff | grep '^+' | grep -cP '\x{2014}|&m[d]ash;|&#82[1]2;|\\u20[1]4'   # must print 0 (brackets keep it from matching itself)
  Absolute paths when run by an agent. Every finding is probed red on the pre-fix file before its test is added.

## Review 32 (opus), all fixed unless stated
- Reviews 30 and 31 patched the whole-quoted-command rule twice and each patch exposed another case (a program word in
  sh -c read as board-files or agent-config; a quoted path through "R & D" read as other). Replaced by ONE rule, the
  shell's: a quoted word with spaces is a command only as the script of a shell's -c (sh, bash, zsh, dash, ksh, fish,
  su) or of eval, and then it is split and never one path; anywhere else it is one argument, so one path. Tests.
- [ and { are globs: Kosm[o]s and Kosmo{s,} hid a token read (home, or other at the home folder). They are hidden words
  now; globRe reads [...] classes and a brace segment matches anything. Tests.
- Two comments run together at clashNow are each on their own line.
- Stated: a script given another way (python -c, osascript -e, ssh host "cmd", watch "cmd") is still one argument as
  well as split, so a quoted script there that starts with / can read as that path (over-claims only to system or
  the class of its first path).

## Review 33 (sonnet), all fixed unless stated
- Review 32's globRe mis-read bracket forms ([]o], [[:lower:]], [[:space:]]) and broke on a brace spanning a /, so a
  token read by an agent at the home folder read as other. Rather than patch each form, globs are read the shell's
  way: {a,b} is expanded first (at most 64 words; an unbalanced brace is literal; a word left with no glob is classed
  as a path), a [...] class of plain characters and ranges is that class and any other bracket form is any one
  character (it can only match more). Tests.
- A hidden word naming no board file literally (Kos[m]os, board.t[o]ken, a star in every segment) was not the board's:
  a hidden word whose segments, as globs, match every segment of a board root reaches the board's files, the glob
  analogue of pathClass. Tests, with controls that must stay home or other (src/b*, ~/{a,b}/notes.txt, ~/Library/*).
- Stated: a glob of stars deep enough to reach the board folder (~/*/*/*/notes) reads as board-files (it can reach
  it); past 64 brace expansions the rest are not looked at; a quoted sentence starting with a path is that path
  (echo "/path/board.token is the file"), an over-claim.

## Review 34 (opus), all fixed unless stated
- BLOCKER: review 33's globRe turned each star into its own [^/]* and backtracked exponentially against a long
  board-root segment (12 stars 2.4 s, 20 over a minute), on the board's main thread, and again on every restart as the
  line is never passed. Replaced by a linear matcher with no regex built from the command (stars merged, one star
  backtrack point). Test with 30 stars.
- One brace budget of 64 words for the whole command, not per word (4 KB of brace groups cost 45 times a plain
  command); a word that hits it is also kept unexpanded, its braced segments matching anything (the 65th alternative,
  Kosmos, was never looked at). Test.
- A brace sequence {a..b} is not expanded: a segment still holding a brace matches anything (it was classed as a
  literal path, home). Test.
- .. in a glob word is applied before segments are compared (path.normalize), in toBoard and reaches. Test.
- A reversed range [z-a] matches nothing, as in bash (the regex threw and fell back to matching anything). Test.

## Review 35 (sonnet), all fixed unless stated
- Review 34's matcher folded a bracket class on a Mac, which bash does not: [^a-z]osmos, Kosm[^A-Z]s, Kosm[Z-o]s and
  Kosmo[!A-Z] read as home. A class now matches in its typed case OR, on a Mac, folded on both sides (it can only
  match more). Test, with two classes that truly exclude the board folder staying home.
- Stated: a segment holding a brace sequence ({1..3}) matches anything, the same over-claim as a deep glob of stars
  (~/Library/{1..3}/* reads as board-files); the brace-bomb timing test guards a blow-up only (the pre-fix code passed
  it at 636 ms), not the budget itself, which the 65th-alternative test covers.

## Review 36 (opus), all fixed unless stated
- Review 20's "nothing from the old queue is ever sent" was false for a Leave the company refused: the server's timer
  stopped ticking (not enrolled here), so nothing marked the state, and the SAME record written back resumed the old
  offsets, sending the refusals made in between. markWithdrawn() (state file only, no transcript) is called by the
  server's timer whenever this is not the work Kosmos, and by the tick when it may not report. Test with both arms (the
  unmarked arm sends the gap), and a wiring test on server.js.
- A path held in a variable (T=.../board.token; cat "$T", export T=...) or behind a command substitution ($(echo ~)/...)
  was classed other or home: NAME=value words have their value looked at, and $( ... ) stays inside its word in
  shellWords (balanced) while its inside is looked at as a command. Tests. (A whole-command name match was tried and
  reverted: it overrode review 1's decision that a resolvable path is classed by the real roots.)
- Three tests could not fail (each passed with its line removed): the future-event and time-filter tests ran in the
  agent's first-listed tick, where a file skips to its end unread; the mid-scan withdrawal test's sources lacked the
  agent-list checks, so the tick returned first. Each now has a control arm. New tests for the halved send size
  resetting and for a withdrawal keeping no queue. Each verified red by mutating its line, with an unmutated control.
- Queue entries without a numeric at, and a send size below 1, are dropped on read (a null entry threw every tick).
- What I got wrong in flight: a // comment placed mid-way through a chained replace commented out the -C/dir and @file
  handling; my probes did not use either and passed, the suite caught it.
- Stated: the "listed this tick" first-sight clause has no test of its own (it is exercised by every test that lists an
  agent, but removing it is not caught); backticks are not kept inside their word as $( ) now is.

## Review 37 (sonnet), all fixed unless stated
- CORRECTION to the review-36 commit message, which said "five mutations each turn their test red": true of the five I
  ran, but the r36 withdrawal test ticked between, which drained the queue, so it passed with the queue clearing, the
  queue-entry filter, or the send-size check removed. Replaced by direct tests (markWithdrawn on a written state;
  _readState, exported for this, on bad entries and send sizes). Each verified red by mutation.
- Nothing pinned that a never-enrolled Kosmos writes no state: tested on an empty root, a corrupt file and enrolledAs
  null.
- isEnrolledHere is false on ANY read error, so a blip cleared the queue for good: withdrawIfStopped() marks only a
  real stop (enrolled with no accepted words, a Leave pending, the enrollment file absent, a record naming another
  world); a read that fails marks nothing. The server's timer and the tick call it. Tests for both blips and for
  absence, each mutation-verified.
- Stated: the "only a missing file, not any stat error" line is unpinned; every error that fails the stat (a
  permission error on the store) also stops the state from being read, so markWithdrawn writes nothing and no test can
  see it (a permission-error arm was written, found unable to fail, and removed). The server.js wiring test is a
  source-text match: it pins the call, not the behaviour, and a reformat turns it red.

## Review 38 (opus), all fixed unless stated
- BLOCKER, the review-36 mistake again: the state was marked withdrawn only when the board's timer or a tick next
  looked, so a Leave left unanswered and then refused (org_last_admin) inside one timer interval wrote the SAME record
  back, and refusals made while it was pending were sent. The stop is now marked WHERE it happens, in
  engine/orgenroll.js: clearEnrollment (every Leave and every refresh that ends it) and writeEnrollment of any record
  without accepted words (consentWithdrawn, a rebuilt record) call markWithdrawn first. The timer and tick remain as a
  backup. Test from the reviewer's repro, red on the pre-fix orgenroll.js.
- A walk from a folder holding a board root (grep -r, find, rg, tar, cp -a, ls -R, chmod -R, the Grep tool) reached
  the board's files but read as home: such a walk is board-files, the same "can reach" rule as review 33's globs. A
  command with no folder walks the agent's own. Test with controls (ls -la, grep -r ., a walk of ~/Library/Caches).
  Found while building it: a quoted spaced path re-split as a command replaced the outer command as current, so its
  folder was not counted; the outer command is restored after every inner split.
- A record naming another world is a stop: now tested (red by mutation).
- Stated: "a Leave pending" in stoppedReporting cannot be told apart in a test (a pending Leave always also removed the
  record, so the absence arm answers first); a walk from / or ~ (find ~ -name x) reads as board-files, which it can
  reach; a walk named only through a glob or a variable is not counted as one.

## Review 39 (sonnet), all fixed unless stated
- The review-38 hook still lost to a tick already reading: the tick had loaded its state before the Leave, and its
  write erased the stop mark; the same record back passed the enrollment check. markWithdrawn now counts stops
  (state.stops); a tick that sees the count changed while it read writes nothing and sends nothing, and the next tick
  starts clean from the mark. Test from the reviewer's repro (both ticks), red on the pre-fix file; the write check
  and the count are each red by mutation. A second check placed just before the send was found unreachable (nothing
  awaits between the write and the send, so nothing can interleave) and removed rather than kept as a guard that does
  nothing.
- A copy's destination (cp, rsync, scp, mv, ditto, install: the last folder; zip: the archive) and tar's -f archive and
  -C folder are not walked (cp -r build ~/ read as a walk of ~). A cd earlier in the command moves where a later
  relative walk starts. Test, red on the pre-fix file.
- Stated: a walk named through a variable ($HOME, review 38's line) IS counted when the variable is $HOME (it is read as
  ~); other variables are not. Ticks are serialised against each other, not against enroll, leave or refresh: the
  stop count is what makes that safe.

## Review 40 (opus), all fixed unless stated
- BLOCKER, the same class a third time: the stop count on disk moved only when the disk already said "reporting", so
  a Leave during an enrollment's FIRST tick (or a stop whose write failed) went uncounted and the gap was sent. Every
  fix so far depended on what the disk said at one moment; the count is now kept in memory (STOPS), moved by every
  markWithdrawn whatever the disk says (the tick and every enrollment writer run in the board process). A tick that
  sees it move writes a withdrawn state and nothing else, so the next tick starts from then. Reviewer's repro, both
  arms, red on the pre-fix files; removing STOPS++ is red.
- orgenroll marks the stop AFTER a record without accepted words has landed, and after the record is removed (a mark
  made before a write that then failed left the words in place and the state withdrawn). Both are synchronous with the
  mark, so no tick runs in between.
- A bare cd and pushd move where a walk starts; tar -C moves where its operands resolve; tar walks only to create or
  add (an extract writes); a walking command's operands include plain names (grep's first is its pattern, find's
  after its first test are values). Test.
- Stated: the withdrawn state written when a tick aborts is not pinned by a test: in every case built, the first-sight
  rule (a file first seen in an agent's first-listed tick starts at its end) also stops the gap. It is kept so the
  invariant does not rest on that rule, which exists for speed.
- What I got wrong in flight, AGAIN: a // comment inserted mid-line by a scripted replace commented out the rest of an
  object literal (a syntax error this time; in review 36 it silently dropped two replaces). Saved as a lesson.

## Review 41 (sonnet), all fixed unless stated
- STOPS protects only a tick already running; a stop whose state write FAILED was lost to the next tick (words
  withdrawn, the same words accepted again: one stop, never re-marked). Such a stop is now carried in memory
  (UNWRITTEN_STOP) and the next tick starts as withdrawn, clearing it once that is on disk. Test built on that path;
  my first version used a refused Leave, which marks again on its retry, so it could not fail (found by mutation and
  rewritten). Red without the carry and on the pre-fix file.
- find's leading options (-H -L -P -E -s -x -d, -O, -D value) come before its folders; grep-like tools given their
  pattern by -e/-f/--regexp/--file keep their first operand, and -- makes a dash word an operand; wrapper options that
  take a value are per wrapper (sudo -n takes none, timeout -s and xargs -I do). Test.
- Stated: a stop lost by a process crash in the instant between the record write and its mark is not recovered for a
  record rewritten without words (a Leave retries and re-marks); a cd inside ( ) or after || moves where later walks
  start (over-claims only).

## Review 42 (opus), all fixed unless stated
- A token read after 64 path words was never looked at (the word scan stopped), and a shell's script inside another
  shell's (bash -c "sh -c '...'") was not split. Inner scripts and substitutions are now split up to three deep, and a
  scan that stops early runs the board token's exact-name search over the whole command (review 1's rule, that a
  resolvable path is classed by the real roots, still holds when the scan is complete). Test, red on the pre-fix file.
- markWithdrawn on a state that exists but cannot be read at that moment carries the stop (UNWRITTEN_STOP), as a failed
  write does. Test, red on the pre-fix file.
- What I got wrong in flight: (1) the first version kept passing depth 1 to every inner split, so nothing ever reached
  depth 2, and declared the scan flag inside the Bash block though it was read outside it (a ReferenceError at run time
  that node --check cannot see); both caught before commit. (2) Allowing nesting made the substitution loop look at
  every $( at every depth: the fourth power of the length, past a minute on 2,600 characters. Only the outermost at each
  depth are looked at now. (3) I first guarded that with a node:test timeout, which cannot interrupt synchronous code
  (the suite would hang, not fail); the input now runs in a child killed after 20 s, red on the slow loop.
