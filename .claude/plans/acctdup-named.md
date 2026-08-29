# Two accounts with one login say which is which

Branch: `acctdup-named`
Author: Mona Lisa, 2026-08-28

## The problem

`docs/browser-checks/named-controls.js` reports
`settings: accounts: no two controls answer to the same name -- Disconnect josh@book.io x2`.

`engine/accounts.js` opens by stating that an account IS a config directory, not
a login. Two directories signed in to one email are therefore honestly two rows,
and `list()` returns both. The accounts row then rendered its **login** as its
identity, so both rows read `josh@book.io`, carried the same badge, and gave two
`Disconnect` buttons the same accessible name. Nothing on screen said why there
were two or which was which.

Measured on this machine from `accounts.list()` rather than from the browser run:
four rows, `josh@book.io` holding two of them (`~/.claude`, the default, and
`~/.claude-account-d`). Not a fixture condition, and it grows as a machine
collects directories.

The field that separates them was already on the row and was being discarded.
`label` and `isDefault` are set by `list()` for every row; the render reached for
them only as a fallback when there was no email, so the single case that needs
them is the case they were dropped in.

## What finished looks like

- Two rows sharing a login each name themselves, and their `Disconnect` controls
  answer to different accessible names.
- A row whose name is unique renders exactly as it does today, byte for byte.
- The rule is guarded by a test that runs the function rather than matching its
  source, with each arm proven able to fail.
- Verified against the real account list on this machine, both arms.

## Approach

1. Add a top-level `accountQualifiers(list)` returning a Map from row to a
   qualifier string, empty when the row's name is already unique. Top-level and
   pure so it can be extracted and run by a test the way `accountGroupsHtml` is.
2. Key it on the name the SCREEN shows (email, or the OpenAI key tail), not on a
   nearby data field, so it answers the question the screen asks.
3. Qualify a duplicated row with `main` when it is the default directory and its
   `label` otherwise, falling back to `dir`. Total for a duplicated row, because
   `list()` skips a directory it has already seen, so distinct rows always have
   distinct `dir`s.
4. Render the qualifier inline beside the name, and include it in the
   `Disconnect` control's `aria-label`, which is the string the check reads.
5. Guard it in `web.account-qualifier.test.js`, perturbing every arm.

## Rejected

| option | why not |
|---|---|
| dedupe to one row | hides a real thing. Two directories are two places an agent can run from; merging them makes the screen lie about the machine |
| always show the label | clutters the common single-account case to fix a case it does not have |
| number them (1, 2) | an invented handle matching nothing the person can see anywhere else on their computer |

## Deliberately out of scope

- **The unsealed sandbox.** `tools/browser-checks.sh` `boot_board` seals nine
  variables and not `AGENT_WORKFORCE_HOME`, and zero of 59 checks seal it
  themselves, so the board `named-controls` renders reads the operator's real
  config directories. That is a second, real defect. This change fixes the
  product and **will make the check go green with the sandbox still unsealed**,
  which is stated in the PR so the green is not read as a fix. Sealing it is a
  shared-harness change whose blast radius needs a harness run to measure.
- **The Disconnect route itself** (#770). The control stays disabled.
- `render-full-width` and `render-settings-nav`, which involve no account
  rendering and have a different cause.
