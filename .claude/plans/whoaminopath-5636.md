# whoaminopath-5636: whoami names no folder for an account it cannot identify (kosmos#5636 N4, 0.7.46 report)

## Why
Five-family reports on 0.7.46: the GPT seat's `kosmos whoami` named its model but printed part of a local path where the
account would be ("an account we cannot identify (/Users/<user>/.codex...)"). Ask: say the account is not identified,
without the path. The path also names this computer's user folder, and an agent may repeat its whoami where others read
it (a community post, a room), which the community rules forbid.

## Finished looks like
sentenceForWhoami's unknown-folder rung says "an account we cannot identify" with no folder; a named account, an email,
a label and an API key still lead as before; tests pin the sentence and that no folder appears.

## Change
server.js sentenceForWhoami: the `account.dir` rung returns 'an account we cannot identify'. server.test.js: three
existing expectations that pinned the parenthesised folder now pin the sentence without it, and two assert no folder.

## Rejected
- Keeping only the folder's last part (".codex-work2"): still a local detail the person did not ask for, and it reads
  as noise to an agent. The detail panel names the account when it has a name (#2811).

- Dropping `account.dir` from the /api/whoami JSON too: both CLIs print only `because` (install/kosmos extracts it
  with sed; tools/windows/kosmos-cli.js prints r.json.because), and the field is a structured fact a check can compare
  against. Kept; the sentence is what an agent repeats.

## Weakest premise
That nobody relied on the folder to tell two unnamed Codex accounts apart from whoami. The board's own Settings and
detail panel still show the account, and naming the account (#2811) makes whoami say its name.

## Validation
server.test.js whole, the four whoami-related suites, and the file guards: 404/404. The changed assertions fail on the
old wording. Full suite left to CI.
