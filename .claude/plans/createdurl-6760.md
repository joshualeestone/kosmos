# createdurl-6760: an install's AGENT_WORKFORCE_CREATED_URL reaches the macOS and Windows service boards (kosmos#6760)

## What was wrong
engine/linuxboard.js writes AGENT_WORKFORCE_CREATED_URL into the systemd unit (#5519), so a Linux test or CI install
keeps its dead beacon address. A macOS launchd board and a Windows logon-task board start with the environment their
own plist or task defines, so the address was lost and the board pinged the real counter.

## Call
- macOS: install/setup.sh appends the variable to `_extra_env_kv`, the pre-built, XML-escaped block both launchd
  plists insert (board and watchdog; the watchdog never pings, so carrying it there is harmless). Only a plain
  http(s) URL, the linuxboard.js rule (no whitespace, quotes, backslash or %); unset adds zero bytes.
- Windows: engine/win32board.js `bootJsFor(env)` adds one line to the logon shim, after the existing MARKER_ENV
  line: `process.env.AGENT_WORKFORCE_CREATED_URL = <JSON string>`. install() writes it from the INSTALLER's
  environment (`s.env || process.env`). Unset, the shim is BOOT_JS byte for byte. JSON-stringified, so a value can
  never add code.

## Rejected
- A new shared module for the URL rule: it trips the engine reachability guards; the one-line regex is repeated with
  a pointer to linuxboard.js.
- Setting it on the Windows task's environment: a scheduled task has no per-task environment; the shim is where the
  board's process starts.

## Weakest premise
The rule is written three times (linuxboard.js, win32board.js, setup.sh's case block). The two shell/JS copies are
each tested with the same bad inputs as Linux's test, but nothing checks the three stay identical.

## Tests
- engine/win32board.test.js 50/50 (2 new): bootJsFor unset == BOOT_JS, one line when set, unsafe values unchanged;
  install() writes the env's URL, CONTROL unset writes BOOT_JS. MUTANT (install writes BOOT_JS): red.
- tools/test-created-url-plist-6760.sh (wired into test:shell): extracts the block and both helpers from setup.sh,
  runs them under /bin/sh: unset zero bytes, http carried with its newline, https XML-escaped, nine unsafe values add
  nothing, and the block sits between `_extra_env_kv=""` and the board plist. MUTANT (no unsafe check): 5 red.

## Review round 1 (blind, opus): no blocker, no warning
- Verified: the variable is in the installer's environment at both points (update.js re-runs setup.sh with
  process.env; server.js calls win32board.ensureInstalled on every boot and the shim sets the variable before the
  board loads); win32board.js is the only writer of board-boot.js (win32anchor writes supervisor-boot.js); nothing
  else rewrites the board plist; escaping holds (XML via _xmlq, JSON.stringify).
- [NIT] the shim read `s.env || process.env` while install reads machineEnv(s) --> FIXED: one source, `env`.
- [NIT] "kept across logons and updates" hid that the LAST install's environment wins --> said in both comments.
- [NIT] control characters passed both filters (XML forbids them; launchd would refuse the plist) --> FIXED in both,
  tested (\001, \177). MUTANT (no [:cntrl:]): red.
- [NIT] the watchdog plist shares the block --> said in the comment.

## Review round 2 (blind, sonnet): converged
- No new issues. [NIT] JS `\s` also rejects Unicode whitespace (NBSP, U+2028) while the shell's [:space:] is ASCII, so
  a URL with NBSP reaches the plist (XML-escaped, valid) but not the shim --> NOT CHANGED: harmless (an address with
  NBSP is not a real CI value, and either outcome is a valid file); the comments say "the rule linuxboard.js
  applies", which win32board.js matches exactly.
