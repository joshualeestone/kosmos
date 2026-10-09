# kosmos#5683 slice 1, board half (part 1a): refused agent actions to the company

Josh 2026-10-09 08:38 (the card), 08:41 (the company owns work content: an event may reference the conversation),
08:43 (every Kosmos on a work computer is the company's). Relay half: kosmos-relay agentevents-5683
(`POST /v1/mac/org/agent-events`, table org_agent_events, apart from org_audit per Pete's #5529 replan).

## What changes
- `engine/agentevents.js`: every 5 minutes (server.js agentEventsTick, the rollup's gates: live execution, enrolled
  here), the enrolled Kosmos with consent recorded (orgenroll.mayReport) reads its TOKEN-ONLY agents' new transcript
  lines (per-file byte offsets, complete lines only, at most 4 MB a file a tick) and queues refusals by the company's
  own rules; it sends at most 50 a tick, Mac-signed; a failed send keeps them (at most 500, 7 days).
- What counts: an error tool result "Permission to use <Tool> ... has been denied." (the token-only guard's deny rules;
  measured text, Claude Code 2.1.295) and a Bash error with "Operation not permitted" (its sandbox).
- An event: world, agent, at (seconds), action (run/write/read/network from the tool), rule, targetClass (one of
  board-files, agent-config, other-agent, home, system, network-host, other), sessionRef (the transcript's session id),
  toolUseRef. Never a command, a path or any text.
- `engine/receipt.js` exports its transcript-folder helpers (one rule for where transcripts are).
- `tools/test-connector-verbs.sh`: the macRequest caller pin re-decided for the new caller.

## Decided (overturn in one line)
- Only token-only agents are read: they are the agents the company's rules (the guard and its sandbox) apply to. A
  person's own deny rules on any other agent, and the auto-mode classifier, are never read or sent.
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
- No upper bound on an event's time (one skewed row cost its batch): events over 5 min ahead are not queued, and a
  queued event is dropped an hour before the coordinator's 7-day limit. Test, P8.
- Consent: a 409 org_consent_changed stops the sends (orgenroll.consentWithdrawn), not_enrolled/not_member refresh,
  as the rollup. The state is keyed on the accepted consent hash too: words accepted again start clean and send
  nothing from before that moment. Test, P9.
- Paths resolved before classifying (agentDir/../.. reached the board's files as 'other'); ~user is 'other'; only
  <agentDir>/.claude/ is agent-config. Test, P7.
- No readable enrollment time sends nothing (it failed open). Test, P10.
- A subagent's transcript references its parent session. Test, P11.
- Every transcript is read from its start the first time (then filtered by time), so a refusal between the enrollment
  and the first tick is not lost; offsets of transcripts that are gone are dropped.
- The computer print is sent as the rollup sends it (the coordinator now checks it, relay review 1).
- The label check is written with escapes (no raw bidi character in the source) and refuses zero-width characters.

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
