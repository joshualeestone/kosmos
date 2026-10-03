# aimodels-5114: send people to "Settings, AI Models", not an Accounts tab that does not exist (#5114)

Card: kosmos#5114, found in #5111's day-one walkthrough of served 0.7.19. Day-one path (Monday 10-05 public beta).

## Finished looks like
No sentence a person can see names "the Accounts tab", "the Accounts screen" or "Settings > Accounts". Each says
"Settings, AI Models", which is what the nav button and the section's aria-label say, and is the wording the rest of
the product already uses ("Add one in Settings, AI Models.", "Sign it in again from Settings, AI Models.").

## The seven sentences
- engine/create.js: no OpenAI sign-in; an OpenAI sign-in not working; no Claude account (the one the card found);
  a Claude sign-in not working.
- server.js: an agent's account-status remedy.
- web/index.html: the connection line's link ("see them in AI Models"), and the slow-confirm message.

## Rejected
- A link that opens AI Models from the create refusal: the refusal is plain text built in the engine, and making it a
  link means a new field on the create answer plus page wiring. Worth doing; not the day-one fix. The words alone
  now name a place the person can see.
- Renaming the internal id (`accounts`, settingsGo('accounts'), #s-sec-accounts): nobody sees it.

## Weakest premise
That "Sign ... in again from Settings, AI Models" is clear without naming the button. The old text said "(Sign in
again)" as the button's label; the sentence now says the action itself.

## Checks
- web.aimodels-name-5114.test.js: every quoted string in web/index.html, server.js, engine/*.js (not tests), the
  Windows CLI and the Mac CLI (install/kosmos), with comments removed first, is free of the old name in any of its
  likely spellings (Accounts tab/screen/page/section/panel, any case; a Settings path ending in Accounts). Red on main,
  where it lists exactly these seven at their real lines; a control proves each spelling is found and each comment
  kind is skipped; an arm checks the nav still says AI Models.
  Known residual: a string containing "/*" could start a stripped "comment" and hide text after it. None does today.
- Tests that read the reworded sentences, updated: engine/create.account-connectable-1903.test.js and
  server.create-live-1903.test.js (the broken-Claude-sign-in refusal, now pinned to "Sign that account in again from
  Settings, AI Models"); server.agent-account-status-1885.test.js (the remedy still names the agent). In
  web.conn-live.test.js only a failure message changed. Other "Re-authenticate" tests quote Claude's own screen, which
  this does not touch.
