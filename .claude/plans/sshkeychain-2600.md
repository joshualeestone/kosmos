# kosmos#2600 (narrowed): say it when a Kosmos is started from SSH on a Mac

## Why
A board started from a remote (SSH) session on a Mac runs in that session's security context, which cannot read the
login Keychain. `claude auth status` there answers loggedIn:false, so the board calls every Claude account "Anthropic
says this account is not signed in" while the same account is signed in on the Mac itself. Measured on Mortals
2026-09-30, three arms (from ssh false; from the agents' tmux session true; all five accounts connected after a
restart from the right context). It cost 14 hours on 09-29 because it looked like a build problem.

## Change (slice 1, this branch)
- `install/kosmos`: `ssh_keychain_note <start|restart>`, called by the `start` and `restart` dispatch after the agent
  guard and before the command. On a Mac, when SSH_CONNECTION, SSH_CLIENT or SSH_TTY is set, it says in one sentence
  that this Kosmos will not be able to read the Mac's Keychain and will show Claude accounts as not signed in, and
  how to start it on the Mac itself. It always returns 0: advice, never a refusal.

## Decided
- Advice, not a refusal: starting from SSH is sometimes the only way in (a headless Mac, an emergency), and a board
  that is up and wrong beats a board that is down. A false positive costs one line.
- Signal: the SSH variables a remote login sets. Rejected: probing the Keychain itself from the CLI
  (`security show-keychain-info`), because the CLI runs in the same context as the board it is about to start, so
  the probe answers the question directly, but it can raise a GUI consent prompt on the Mac, and a start must never
  block on a dialog nobody sees.
- NOT in this slice: the board's own "not signed in" verdict naming the likely cause (slice 2, an engine change), and
  the fleet default `CLAUDE_CODE_OAUTH_TOKEN` passthrough (parked: needs `claude setup-token` per account by a person).

## Weakest premise
That the SSH variables are present. A remote session that strips them, or a board started by a launchd job created
from SSH, is not caught.

## Tests
- tools/test-ssh-keychain-note-2600.sh (9 arms, wired into test:shell): a start from SSH on a Mac gives the note,
  names `kosmos start`, returns 0; a restart with only SSH_TTY names `kosmos restart`; CONTROL: no SSH variables, no
  note; a non-Mac host, no note; sourcing the CLI writes nothing to HOME; both dispatch lines call it before the
  command. The CLI is SOURCED (it returns before its dispatch), so no board is started.
- 5 sabotages, each red: no SSH check, no Mac check, SSH_TTY ignored, start not wired, the note returns 1.
- Existing CLI tests checked by hand for output assertions the note could break when a suite runs over SSH (as on
  Mortals): the start/restart arms use positive matches only; the START_ADVICE / "kosmos start" negatives are on
  msg, report, status, post, connections, connect and community, never start or restart.
