# pbpanel-7404: personal backup's panel says what the job did (slice C of #7404)

The job (#7710) is built dark, and a stop reaches only the log. This slice makes the state a person can see true.

- engine/personalbackup.js: runJob notes the last good run and the reason for a stop a person must act on, in the module's
  own root; a passing failure changes neither. report() answers both, and also covers a gate that keeps every run from
  starting, where no run can leave a reason.
- GET /api/personal-backup carries it as job. The panel says the last backup, or that it stopped, why, and when it last ran.
- The words heading changes so the 30-day line is not listed as a thing backed up.

The note holds fixed sentences only: a run's because passes through only for personActs, which this module's key step
writes, since other reasons can carry a server's text. A used-up week is a note, not a stop. A note names its org and world.

Decisions: a note file beside the record, removed on turn off, rather than asking Kosmos+ what the last manifest was.
Rejected: a new state() value, because state() drives the screens #7681 settled, and stopped is still on. Weakest premise:
with a company here the panel says nothing about the job, which is true but tells the person nothing.

Not here: a real way forward for a different key here (it names none), the off-then-on price dependency (#7685), the
Antigravity staging before the key step, and slice D.
