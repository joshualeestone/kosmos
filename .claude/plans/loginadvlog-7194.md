# loginadvlog-7194: record what the login-expiry notice read (kosmos#7194)

Owner: Ice Cream Kitty. Asked by Splinter 2026-10-26 08:03 after #7194 could not be reproduced: the board named eight
agents on a login they had left, and nothing recorded what it had read, so the cause was unrecoverable.

## Change
- engine/status.js `paneCcdRead(target)`: the pane read with where it was made, { ccd, pid, cmd } (it replaces paneCcd,
  whose one caller was computeLoginAdvisories).
- computeLoginAdvisories keeps each agent's read (folder, pid, pane). `logLoginAdvReads` writes to the board log
  (console.error, which the board sends to ~/.local/share/kosmos/logs/board.log) ONLY when the notices change:
  - one line per named agent: `[loginadv] #7194: casey read CLAUDE_CONFIG_DIR=<dir> from ps eww of pid <pid> (pane
    <target>), in the notice for <email> (<keychain service>), expires in N days`
  - an agent with no CLAUDE_CONFIG_DIR is written as "the default login"
  - notices that clear: `[loginadv] #7194: no login notice now`, once.
- No change to what the notice shows or who it names.

## Decided
- On change only (a signature of service, email, days or expired, and each named agent with the folder and pid read
  for it): a standing notice writes its lines once a day as its days count down, and every raise, change, move or
  restart is on record. A board with no notice writes nothing. (Review 3: the agents alone missed #7194's own case,
  where the notice reads the same while what was read changed.)
- The line names the program the pid runs (the base name of `ps -o comm=`, never its arguments or environment). It is
  a second read of that pid, made only when a line is written, so a pid reused between the two reads could pair one
  process's folder with another's name; accepted, as pids are not reused within seconds here.
- The email comes from a file, so control characters are stripped before it reaches the line.
- The log, not /api/status: the record must outlive the moment, and a person should not have to fetch it.
- No secret is written: a folder path, a process id, a pane name, the email the notice already shows, and the keychain
  service name (not its contents).

## Weakest premise
That the record is enough to diagnose a recurrence. It names what was read and from which process; if a recurrence shows
a folder that process does not hold, `ps eww <pid>` at that time is the next instrument.

## Checks
- engine/loginadvlog-7194.test.js: one line per named agent with folder, pid and pane; no repeat for the same notices;
  a change writes again; clearing writes one line, once; a missing variable reads as the default login; nothing while
  there is no notice. Mutations, each red: the log call removed; the change check removed; the pid dropped.
- engine/loginexpiry-snapshot-3532.test.js and engine/loginexpiry.test.js unchanged and green.
