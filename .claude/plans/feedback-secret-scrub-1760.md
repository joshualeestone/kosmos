# Plan: scrub secrets from the daily feedback report send path (#1760 audit slice 15)

## Problem
The daily product-feedback report (#2037 / #2246) is **agent-authored free text**
POSTed off the box by default to `https://installkosmos.com/api/feedback`. Two
protective layers exist:
- the author prompt (`engine/roles.js`): "Do not share usernames, agent names, or
  project names in the report."
- `scrub()` (`engine/feedbacksend.js`): rewrites home paths and redacts install
  names (agent/project/OS-account names).

Both cover identifying **names**. Neither covers **secrets** (API keys, tokens,
passwords). The body answers "what bugs did you hit / what's broken / what would
help technically", which invites quoting an error, a log line, or a config -
exactly where a live credential rides along. `scrub()` passes such a value through
verbatim, so a beta tester's report could exfiltrate a live key to the collector.
Filed as audit slice 15 on kosmos#1760.

## Approach
Symmetric belt-and-suspenders with the existing name defence, both layers:

1. **Author prompt (`engine/roles.js`)** - extend the "Do not share ..." line to
   also forbid pasting a secret / API key / token / password, and to redact any
   key/token when quoting an error, log, or config.

2. **`scrub()` backstop (`engine/feedbacksend.js`)** - add secret-redaction arms
   that run BEFORE the install-name arm (order: home-path arms -> secret arms ->
   name arm), so a project/agent named like a secret label ("Token") cannot have
   its label stripped by the name arm before the secret arm anchors on it. All
   quantifiers are bounded (no unbounded run before a required terminator) because
   scrub() runs synchronously on the board event loop and must never block:
   - high-confidence provider shapes (a deliberately curated, non-exhaustive
     subset - the prompt is the primary defence): OpenAI/Anthropic `sk-`/`sk-ant-`,
     Stripe `sk_live_`/`sk_test_`/`rk_…` (underscore; Stripe is Kosmos's payment
     provider), GitHub `ghp_/gho_/ghs_/ghr_/ghu_/github_pat_`, npm `npm_`, AWS
     `AKIA…` and temp `ASIA…`, Google `AIza…` and OAuth `ya29.…`, Slack
     `xox[baprs]-…` and app-level `xapp-…`, three-segment JWT `eyJ….….…`. Every
     prefix arm carries a `(?<![A-Za-z0-9])` lookbehind so none matches mid-word;
   - the labelled-assignment arm uses a `(?<![A-Za-z0-9])` lookbehind (not `\b`,
     which misses snake_case labels like `client_secret=`) and requires the value
     to contain a digit or token symbol, so diagnostic prose ("token: undefined")
     survives while a real credential value does not;
   - a `Bearer <token>` arm that keeps the scheme word and redacts the credential;
   - a conservative `api_key|secret|token|password|passwd|key = <value>` assignment
     arm (JSON-quoted labels too) that keeps the label and redacts only a >=8-char
     value containing a digit or base64 symbol; the value stops at `& , ;` (query /
     list / cookie separators) and all its quantifiers are bounded (no ReDoS /
     stack overflow, since scrub runs synchronously on the board event loop).
   - The `sk-` arm carries a leading non-alphanumeric lookbehind so common prose
     like "risk-management-strategy" is not corrupted. Over-redaction is the safe
     direction, matching every arm already in `scrub()`.

## Tests (`engine/feedbacksend.test.js`)
- Each provider shape pins RED: a planted secret does not survive `scrub()`.
- Bearer credential redacted, scheme word kept.
- Labelled assignment value redacted, label kept.
- False-positive guards: "risk-management-strategy" and label-without-value prose
  ("the token is invalid", "secret: it works") survive untouched.
- A negative control confirmed the pre-fix `scrub()` leaks all provider shapes, so
  the tests are not vacuous.

## Weakest premise
That an agent would ever paste a live secret into a *product-feedback* report. It
is not the report's job to carry values, but bug reports quote errors and config,
and errors/config are where secrets live. The name defence was built
belt-and-suspenders for the same reason; this applies it one step further.

## Out of scope
The collector side (server-side handling of a received body). This closes the
client-side send path only.
