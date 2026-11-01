# orgkeyhelper-7741: the org chart read reaches a Claude key account's key (kosmos#7741)

## Why
`claude -p --setting-sources ''` stops `apiKeyHelper` from running, and that is a key account's only credential, so the
read ended "Not logged in". Measured with a stub helper in a throwaway config dir and a fake key: fired 0 times and
"Not logged in" with `--setting-sources ''`; 7 times with `--setting-sources user`.

## The call
Keep `--setting-sources ''` and add `--settings '{"apiKeyHelper": ...}'`, carrying that one value. Measured: fired 7 times.
It is passed only when it is exactly `apiKeyHelperCommand(dir)`, the command Kosmos wrote, which cats the account's key
file. The argv holds that path, never the key.

Rejected: dropping `--setting-sources ''` (the person's hooks and CLAUDE.md would load into a run whose flags are its
security). Passing whatever helper the settings hold (a command the person wrote would run on this path). Falling back to
another reader when the account is a key account (more change, and it leaves Claude unusable where it could work).

## Not done
A person's own hand-written helper still fails the read, as it always has. `claudeHere()` is unchanged.

## Weakest premise
The stub fired, but no real key went through: the helper firing is measured, a real answer is not. 7 fires came from
retries on a 401 from the fake key, until a 60 s alarm.
