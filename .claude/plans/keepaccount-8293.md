# keepaccount-8293: connect keeps the account and model an agent last ran on

Found by the #8290 throwaway test: an agent brought in through Found agents started on the default account and model.

## Measured, on 17 fleet agents, against the account and --model in each launch script
| signal | right | none | wrong |
|---|---|---|---|
| .claude.json projects[dir].lastSessionId = newest transcript | 0 | 17 | 0 |
| .claude.json highest lastStartTime | 8 | 0 | 9 |
| session-env/<newest session id> present in exactly one account dir | 17 | 0 | 0 |
| file-history/<newest session id> present in exactly one account dir | 17 | 0 | 0 |
| history.jsonl newest entry for the folder | 17 | 0 | 0 |

Model: the transcript's last non-sidechain, non-synthetic assistant row matched --model on 15 of 17. Of the other two, one
was my regex reading a stray backtick, and one launcher says Opus 5.5 where the transcript says Fable 5.1 (the session is
what ran, so the transcript is the better answer).

## Change
engine/discover.js lastRunOf reads those, and connect passes configDir and model to create.installJob, which already
takes them. Claude agents only. web/index.html says so on the Found row only when the account or model could not be told.

## Decided
- session-env, then file-history. Rejected history.jsonl: as accurate here, but it holds only typed prompts and is a whole
  file to read per account, and a channel-fed agent may have none.
- Keep the exact model id even if it is not in Kosmos's menu: silently changing it is the defect. Bounded by the id shape
  and company policy. Rejected: mapping to the menu, which would change an off-menu agent.
- Josh's "no sentence on success" stands: nothing is said when both are kept. The sentence is only for what we could not keep.

## Weakest premise
session-env is an undocumented Claude Code layout. If a release stops writing it and file-history, every connect reads
"could not tell" and goes to the default, which is today's behaviour plus a true sentence.

## Not covered
Codex and other runners. Turning off an old launch job is #8294.
