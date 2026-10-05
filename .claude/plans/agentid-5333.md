# agentid-5333: a running agent whose token Kosmos no longer recognises is told how to recover (kosmos#5333, slice 1)

Day-one report (install 9e0ad784, 2026-10-05 18:23 UTC): an agent running in its own session had `kosmos whoami`,
`kosmos inbox` and `kosmos reply` all refused with "we could not match that to one of your agents"; it recovered only
after `kosmos adopt --confirm` and exporting, by hand, a token found in the sendertokens store. Nothing said how.

## Measured (on this card's branch, with file:line in the card comment)
- A session's token is fixed at launch: the supervisor hands it to the runner's process environment through a one-use
  file (bin/agent-supervisor.sh pane entry). Nothing can give a running session a new one.
- A presented token that does not resolve is refused, never retried on the pane (server.js resolveAgentSender), on
  purpose: removing an agent revokes its tokens and must cut off a session left running.
- `kosmos adopt --confirm` mints a token and throws its value away (engine/adopt.js apply), so it cannot help a running
  session. What worked for the reporter was the token adopt minted, found by hand.
- The adopt listing proves less than the report reads into it: adopt lists every agent whose profile has no `origin`.
- The token was not in the store the board reads. What removed it (or where it was minted instead) is not known from
  the report: it carries no version, and this install sent nothing before. #4530's launch sweep was checked first (the
  card's prime suspect): it retires only runs of a session that no longer exists, and is verified live on Mortals.

## Finished looks like (this slice)
- When this session sent its agent token and the board answers whoami, inbox or reply with the no-match sentence, the
  Mac CLI (install/kosmos) and the Windows CLI print, after the board's words: what happened, that a running session
  cannot take a new token, the recovery (ask your person to restart you from Kosmos: your page, Restart), and that
  `kosmos adopt` does not help a running session.
- No change when no token was sent (the pane path: there is no token to have been refused), or for any other refusal.
- The board's sentence is unchanged (sendertoken NO_MATCH must not tell a probe whether a token was ever real).
- cli.token-refused-5333.test.js drives both CLIs against a stub answering each route exactly as server.js does.

## Decided
- The hint lives in the CLI, not the board: the caller already knows it sent a token, so nothing is disclosed.
- Rejected: retrying without the token (the pane path). It would re-admit an agent the person removed but left running.
- Rejected for now: handing a running session a fresh token. A session's environment cannot be changed from outside,
  and a token file a session could re-read is a new secret on disk; that needs the #4530 owners (Scorpion, Liu Kang).
- Next slice (2): the board compares each live run's @kosmos_token_instance with the token store and tells the person
  on the agent's card when a running agent has lost its link, whatever removed it.

## Weakest premise
That a restart is acceptable as the recovery. It costs the agent its conversation context; the alternative (a fresh
token without a restart) needs a security design that is not this slice's to make alone.
