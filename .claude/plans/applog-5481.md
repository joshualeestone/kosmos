# applog-5481: the native app's log lines reach a person's Mac (#5481)

## Finished looks like
On a real Mac, the microphone permission lines #5481 waits on ("voice: speech permission ... -> ... in N ms" and
"voice: back from Settings (...)") are recorded somewhere a person or agent can read, so the card can close on the
first real use. Then the card's remaining device check is possible at all.

## What was wrong (read from the code)
#5481's build merged in #5504; the card stayed open for two answers "logged by the app". logLine writes only to
$KOSMOS_APP_LOG, else /tmp/kosmos-app-test/app.log. Production sets no KOSMOS_APP_LOG and a real Mac has no
/tmp/kosmos-app-test folder, so FileManager.createFile fails silently and every native logLine (about 150 call sites)
is written nowhere. #5311's plan noticed this for one line and worked around it with NSLog there only.

## The call
logLine first writes the unified log (NSLog("%@", s)), then the harness file as before. Read it with
`log show --last 1d --predicate 'process == "Kosmos"'`. The #5311 voice-ended line keeps reaching the unified log
every time, once: NSLog for our own stop, logLine (which now NSLogs) for a real error.

## Rejected
- A real log FILE (~/Library/Logs/Kosmos/app.log): needs rotation and a size cap, and the unified log already has
  both, plus Console.app. Can be added later if support wants a file to attach.
- A build-time selftest that queries `log show`: makes every release cut depend on the unified log answering.

## Checked
- Content: the logLine calls carry paths, error codes, versions and the updater's last line, never speech text (the
  voice lines are domain and code only, per #5311). The unified log stays on the Mac.
- tools/test-install.sh launches the app with stderr to /dev/null, so NSLog's stderr copy breaks nothing there.
- swiftc -typecheck of main.swift passes (one pre-existing deprecation warning).

## Weakest premise
Not executed here: running a freshly built binary on this shared Mac was refused by the session's permission check
(the full app's startup could touch the live install), so the unified log write is reasoned from NSLog's documented
behaviour and #5311's use of it, not measured. The first real use answers it: `log show` either has the lines or not.

## Verify
native-app.applog-5481.test.js (source: logLine's first statement is the NSLog; the two permission lines go through
logLine; the voice-ended line is logged once); removing the NSLog fails it (measured). Every test reading
main.swift plus the file guards: 371 pass, 0 fail.
