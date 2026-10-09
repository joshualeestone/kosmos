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
  time an event must be at or after (whole seconds). A transcript first seen is read from its start only if written
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
