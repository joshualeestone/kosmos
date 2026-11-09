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
was my regex reading a stray backtick, and one launcher says Opus 5.5 where the transcript says Fable 5.1, cause not found.

## Change
engine/discover.js lastRunOf reads those, and connect passes configDir and model to create.installJob, which already
takes them. Claude agents only. web/index.html says so on the Found row only when the account or model could not be told.

## Decided
- session-env, then file-history. Rejected history.jsonl: as accurate here, but it holds only typed prompts and is a whole
  file to read per account, and a channel-fed agent may have none.
- Keep the exact model id even if it is not in Kosmos's menu: silently changing it is the defect. Claude ids only, kept only
  on the account it ran on, and company policy is asked about that model (a policy listing it passes; one that does not refuses). Rejected: mapping to the menu, which would change an off-menu agent.
- Cost, accepted: the last row can be a one-off /model switch or a fallback, and it is pinned into the job. An agent that ran
  with no --model stops following Claude Code's default and needs moving when that model retires. The model menu changes it.
- Josh's "no sentence on success" stands: nothing is said when both are kept. The sentence is only for what we could not keep.

## Weakest premise
session-env is an undocumented Claude Code layout. If a release stops writing it and file-history, every connect reads
"could not tell" for the account and goes to the main one, which is today's account behaviour plus a true sentence; the
model goes to the default with it, since the main account may not be able to run the old one.

A session on another computer, or one that never wrote these folders, also reads "could not tell"; that is said to the person.

## Not covered
Codex and other runners. Turning off an old launch job is #8294.
