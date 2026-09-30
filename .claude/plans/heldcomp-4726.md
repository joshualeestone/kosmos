# #4726: a computer still waiting for approval renders as held

Card: joshualeestone/kosmos#4726 (Splinter, claimed for PigeonPete). Field from Ice Cream Kitty's #4681
(retirehold-4681): `held`, a plain bool always present on /v1/mac/account-computers and /v1/account/macs;
absent reads as false; a held computer IS listed for the account's other computers; retired wins; offer
Retire, never Open.

## This repo (the switcher)
- engine/account-computers.js parseComputers carries `held: r.held === true`; fetchComputers does not probe a
  held computer (it cannot serve until allowed, and is never opened from the switcher).
- web/index.html computersRender: a held row is never a link, is greyed (worldsw-row-off) and says
  "Waiting for approval on your other computer".

## kosmos-relay (the web account page), branch heldcomp-4726
- coordinator/src/signin.html macWhen: "Waiting to be allowed from your other computer." after the retired
  check (retired wins); macStale ignores a held row; class " held" (name muted) unless retired. Retire stays.

## Checks
- engine/account-computers.test.js (+2): held parsed, absent is false; a held row is not probed.
- web.computers-switcher-4648.test.js (+1): the held row is no link and says it is waiting.
- relay coordinator/tests/page/signin.test.js (+1). Each control (revert) goes red.

## Lands after #4681 deploys; forward-compatible before (absent field reads as not held).
