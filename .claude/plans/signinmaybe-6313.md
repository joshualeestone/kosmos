# signinmaybe-6313: the sign-in code step claims only what the board knows

Card: #6313. Owner: Angel.

## Done means
For an address with no account, the code step makes no false claim, shows the address large with a one-press way
back to fix it, and after a minute with nothing typed says to check the address and offers to create an account.
An address with an account sees the identical screen. The coordinator is untouched.

## Steps
1. [x] `web/index.html` `#plus-si-code`: lead "If this address has a Kosmos+ account, a code is on its way. It works
   for 10 minutes."; the address on its own larger line with "Wrong address? Change it" (plusSiStartOver, which keeps
   the address); a hidden "Nothing yet? ..." line with "Create an account" (href copied from the Join link).
2. [x] A 60-second timer armed on every good ask, reset by plusSiClear and by the next ask; it shows the line only
   while the code step is on screen and nothing is typed. Resend line now "Asked for another code."
3. [x] Browser check render-plus-signin-3478 (existing-2fa): the lead, the address size, the change link, the line
   hidden before a minute and shown after (page clock), Change it keeps the address, a new ask hides the line.
   web.code-box.test.js slices the new helper.

## Decided, not missed
- Same screen for every address: the board cannot know whether an account exists, and must not try (anti-enumeration).
- "Asked for another code." replaces "We sent another code." for the same reason.
- Weakest premise: one minute is a guess at when a person starts to wonder; mail usually lands in seconds.
