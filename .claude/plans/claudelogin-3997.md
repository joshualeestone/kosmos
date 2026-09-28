# claudelogin-3997: an idle Claude sign-in shows its login as good (ruling C)

Addresses #3997 (reopened 2026-09-28 by Splinter; claimed:raiden, Liu Kang m2407).

## Finished when
- On Josh's Settings > AI Models, a signed-in Claude account no agent is using no longer reads amber.
- It shows a calm neutral "Signed in · login good until <date>", with the tooltip "It turns green the first time an
  agent uses it, or when you press Check now."
- It never shows green from that alone. A rejection on record still wins, and a real request still turns it green.
- No token is renewed or rotated, and nothing is spent.

## Why it was amber (read from the code)
- A Claude row turns green only from a real outcome: an agent's request, or Check now, which runs a paid `claude -p`
  (server.js `/api/accounts` overlay, `observed.verdict`).
- `claude auth status --json` is local and expiry-blind (#874). It gives `loggedIn`, the method, the plan and the
  identity, and no expiry (measured on this Mac, values hidden). So `checkLive` 'connected' maps to
  `signed_in_unverified`, which is amber since #3997.
- OpenAI turned green because codex's own sign-in handshake is a free, real answer (#4070).

## The ruling (Liu Kang, m2412, on the card)
- I asked whether an unexpired login may turn an idle account green. Splinter's reopen asked for "the credential
  file's validity and expiry", but the page records Josh's rule: green = "we SAW a request succeed" or "a free live
  check got an answer", "never from a credential that merely exists" (#864/#874/#1921).
- **Ruling C:** neither amber nor green. A calm neutral state with the date and that tooltip.
  - A (green) breaks Josh's written rule, which Liu Kang will not override without him.
  - B (amber) reads as broken.
  - Keep a switch so Josh can flip it to green. Never rotate a token to force a check.
- Rejected: a truly live free check through Anthropic's OAuth profile endpoint. It needs the short-lived access
  token, which on an idle account has usually expired, and renewing it would rotate Claude Code's stored login. So
  it would not fix the idle case.

## Change
- `engine/claudeloginlive.js` (new):
  - `validUntil(row)` reads `claudeAiOauth.refreshTokenExpiresAt` through `loginexpiry` (the number only, never a
    token), from the entry `claude auth status` reads for that row: the default account with `CLAUDE_CONFIG_DIR`
    unset, others with their folder (`accounts.listLiveNow`; the #2129 set-vs-unset class). Key accounts are
    skipped (they have a real live check).
  - The read is async, cached for 60 s per entry, never rejects, and returns null off macOS and under
    `node --test` unless a reader is injected.
  - `loginGood()`: an unverified badge, `claude auth status` connected, the date ahead, and no rejection on record
    (the newest outcome of any age).
  - `greenFromLogin()`: the same, only while `GREEN_FROM_LOGIN` is on (off by the ruling).
- `server.js` `/api/accounts`: the rows' login dates are read in parallel before the Claude overlay. A login-good
  row carries `connection.loginValidUntil`, and its badge stays `signed_in_unverified` (`working` with
  `observedFrom: 'login'` only if the switch is on).
- `web/index.html`: a new `.acct-loginok` pill (label colour, neutral dot), and the colour legend comment updates.
  An unverified row with a date renders "Signed in · login good until <Mon d>" and the ruling's tooltip. Check now
  stays, since the badge is unchanged.

## Pins
- `engine/claudeloginlive.test.js`: the `loginGood` truth table, the switch, the key-account skip, the
  default-account mapping, the cache window, and a throwing or nonsense reader.
- `server.claudelogin-3997.test.js` runs through the real `/api/accounts` with the reader injected. It checks:
  - dated rows stay unverified;
  - a login that has run out gets no date;
  - the default account is read unset and the others with their folder;
  - fresh and old rejections both win;
  - a real request is still green;
  - the switch is off.
  - Mutation controls: dropping the rejection guard reds the rejection test, and reading the default account with
    its folder set reds the mapping test.
- `docs/browser-checks/render-account-badge-1921.js` (the check the surface gate maps) gains a login-good row. On
  main it renders amber "Signed in" (3 FAILs); on this branch it passes.

## Weakest part
- The neutral state is still a local fact. A login cancelled on Anthropic's side shows "login good" until an agent
  or Check now meets the refusal (then red). The tooltip does not claim a live answer, and the pill is not green.
- `toLocaleDateString` is the viewer's locale and time zone, so the date can read one day off near midnight UTC.
