# applog-5481: the native app's log lines reach a person's Mac (#5481)

## Finished looks like
On a real Mac, the microphone permission lines #5481 waits on ("voice: speech permission ... -> ... in N ms" and
"voice: back from Settings (...)") are recorded somewhere a person or agent can read, so the card can close on the
first real use. Then the card's remaining device check is possible at all.

## What was wrong (read from the code)
#5481's build merged in #5504; the card stayed open for two answers "logged by the app". logLine writes only to
$KOSMOS_APP_LOG, else /tmp/kosmos-app-test/app.log. Production sets no KOSMOS_APP_LOG and a real Mac has no
/tmp/kosmos-app-test folder, so FileManager.createFile fails silently and every native logLine (149 call sites)
is written nowhere. #5311's plan noticed this for one line and worked around it with NSLog there only.

## The call (revised after review 1)
A narrow `logToSystem(_:)` writes macOS's unified log (NSLog("%@", s)) and the harness file. Only the two microphone
permission lines the card waits on use it; logLine itself is unchanged and never writes the unified log. Read them
with `log show --last 1d --predicate 'process == "Kosmos"'`. Those two lines are built from fixed words, the pane
name (only "speech" or "mic" are accepted before it is stored), and an outcome kind (allowed, refused or settings-next;
the event's page-supplied id is never logged), permission states, seconds and an outcome word.

## Rejected
- Every logLine to the unified log (the first version): review 1 found the board URL with its token (#1946) logged on
  every launch and reload, plus navigation URLs, page titles and download file names. The unified log keeps lines for
  days and any admin on the Mac can read it, so that would hand another account the token. Removed, not redacted:
  a redaction rule would be one more thing every future logLine must not break.
- A log FILE under ~/Library/Logs: needs rotation and a cap, and has the same content question for every line.
- A build-time selftest that queries `log show`: makes every release cut depend on the unified log answering.

## Checked
- tools/test-install.sh launches the app with stderr to /dev/null; the build gates in tools/build-kosmos-bundle.sh
  match their own tokens, which these two lines do not contain.
- swiftc -typecheck of main.swift passes (only pre-existing warnings).

## Weakest premise
Not executed here: running a freshly built binary on this shared Mac was refused by the session's permission check
(the full app's startup could touch the live install), so the unified log write is reasoned from NSLog's documented
behaviour and #5311's use of it, not measured. The first real use answers it: `log show` either has the lines or not.

## Verify
native-app.applog-5481.test.js: logLine never writes the unified log; logToSystem does, with a fixed format; it has
exactly the two permission lines as callers and neither carries a URL, title, name, path or token. Measured: a blanket
NSLog in logLine, the tokenized LOADING URL sent through logToSystem, and a permission line moved back to logLine each
fail it.

## Review 1 (opus), and what changed
- BLOCKER, fixed by removal: the blanket unified-log write leaked the board token (LOADING and reload lines). My first
  privacy check grepped call sites for words like "token" and missed URLs built elsewhere; the redesign does not rely
  on reading 150 call sites, it allows two and pins them.

## Review 2 (sonnet): converged (nits only). Traced the one premise it left open: outcome.event["kind"] is only
allowed, refused or settings-next (allowedEvent), and the line logs the kind, not the page's id.
