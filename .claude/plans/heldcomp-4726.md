# #4726: a computer still waiting for approval renders as held

Card: joshualeestone/kosmos#4726 (Splinter, claimed for PigeonPete). Field from Ice Cream Kitty's #4681
(retirehold-4681): `held`, a plain bool always present on /v1/mac/account-computers and /v1/account/macs;
absent reads as false; a held computer IS listed for the account's other computers; retired wins; offer
Retire, never Open.

## This repo (the switcher)
- engine/account-computers.js parseComputers carries `held: r.held === true`; fetchComputers does not probe a
  held computer (it cannot serve until allowed, and is never opened from the switcher).
- web/index.html computersRender: a held row is never a link, is greyed (worldsw-row-off) and says
  "Waiting to be allowed" (the whole sentence is its title, so a narrow menu keeps the name).

## kosmos-relay (the web account page), branch heldcomp-4726
- coordinator/src/signin.html macWhen: "Waiting to be allowed from another of your computers." after the retired
  check (retired wins); macStale ignores a held row; class " held" (name muted) unless retired. Retire stays.

## Checks
- engine/account-computers.test.js (+2): held parsed, absent is false; a held row is not probed.
- web.computers-switcher-4648.test.js (+1): the held row is no link and says it is waiting.
- relay coordinator/tests/page/signin.test.js (+1). Each control (revert) goes red.

## Lands after #4681 deploys; forward-compatible before (absent field reads as not held).

## Blind review round 1 (Opus): one BLOCKER, in #4681 (not this card's code)
The sign-in answer's plain `addresses` list (the web page's Open buttons, arrived() auto-open, the Android
switcher) included held computers. Sent to Ice Cream Kitty; FIXED in #4681 (open_addresses: live AND not held,
with a test and a control). NIT fixed: one wording on both surfaces, not "your other computer" (singular).
NIT accepted: a held row never reads stale (it keeps saying it is waiting; Retire is offered).

## Blind review round 2 (Sonnet): two WARNINGs, both fixed
- The long held sentence could squeeze the computer name out of a narrow switcher --> the state reads
  "Waiting to be allowed"; the whole sentence is the row title (tested).
- Retired-and-held in the switcher --> not reachable: the coordinator never lists a retired computer on
  /v1/mac/account-computers (macs.rs filters retired_at); written in parseComputers.
NITs accepted: the switcher has no Retire on any row (the account page does); held rows sort by name with
the others (they ARE listed, per the spec); a held row is a plain div like the other off rows.
