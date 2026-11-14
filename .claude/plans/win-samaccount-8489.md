# win-samaccount-8489: the same person no longer reads as a changed account at Start at login (kosmos#8489)

**Posture:** production

## Problem
kosmos#8478 records, with a Windows agent's account folder, whose account the folder held (create.win32AccountIdentity),
and Start at login (register.repair, through create.win32RecordedTask) puts the folder back only while it still holds
that account. Otherwise the agent starts on the main account, the person is told "the account in the folder it used has
signed out or changed", and the record moves to the main account for good. The same person could read as changed:
1. The recorded `org` fell back to the organization NAME when Claude Code had written no uuid; once it writes the uuid,
   or the organization is renamed, the comparison failed for the same email (reproduced on the card).
2. A config read while Claude Code (or codex, or grok) is writing it does not parse, the identity read as null, and
   null is "changed".
Both failed safe (main account), but the words were false and the record was dropped.
Card comment: an API key was matched by its last four characters only, so two keys sharing them read as one account.

## Decisions
- (a) Organizations are compared by id only, and only when BOTH sides have one; otherwise the email alone decides.
  For Claude the id is the organization uuid (a uuid-shaped value; a recorded name never counts as one), and new
  records keep only the uuid (null when Claude Code wrote none). For codex the id is the ChatGPT workspace id, which
  is never a name, so its rule is the same "both or email alone". Old records holding a name keep working: the name is
  ignored and the email decides. Rejected: keeping a name and comparing it when both sides have names (a rename is
  exactly that case). Rejected: a separate `orgUuid` field (changes the record shape the 8478 tests pin, for no gain).
- (b) create.win32AccountIdentityRead answers { identity, unreadable }. Unreadable = a credential file that is there
  but cannot be read or parsed right now, or (Claude) no config at all and no key beside it. win32RecordedTask then
  answers accountWhy 'unreadable' (new), register.repair keeps it like 'unreachable' (folder and recorded identity,
  task on the main account this time), and delete-leftover.startsAgainWords says: "Kosmos could not read which account
  is signed in to the folder it used just now, so it starts on your main account unless it can read that by then and
  it is still the same account. If it still cannot, Kosmos keeps that folder and tries it again at the next Start at
  login." A config read whole with no sign-in (signed out), and a codex auth.json that is gone (codex logout deletes
  it), stay 'changed'. A Grok auth.json that parses but holds no single x.ai sign-in is "could not read" (readAuth's
  own 'unreadable'; Kosmos genuinely cannot say whose it is).
  The account modules' identityOf are NOT changed: their lists rightly treat both cases as "no account here". The
  reader lives in create.js, reading the same files; openaiaccounts now exports identityFromData so codex is read from
  one read of auth.json (a second read could land mid-write).
- (c) Every API key (Claude, OpenAI/codex, Gemini, Grok) is recorded with keyHash = the first 16 hex characters of the
  sha256 of the whole key (WIN32_KEY_FINGERPRINT_HEX), plus the last four as before. A record with keyHash is matched
  by keyHash only; a record without one (written before this) is matched by the last four exactly as before, so no
  match is wider than it was. A repair that puts the folder back records the fingerprint from then on. The key itself
  is never in the record or a log.

## Modules checked
- Claude (accounts.identityOf + the key file): both problems; fixed (a), (b), (c).
- OpenAI/codex: no org-name problem (workspace id); mid-write auth.json was "changed": fixed (b); key tail: fixed (c).
- Gemini: keys only; an unreadable key file (not ENOENT) was "changed": fixed (b); key tail: fixed (c).
- Grok: key file unreadable and mid-write auth.json were "changed": fixed (b); key tail: fixed (c).

## Weakest part
A Claude folder with NO config and no key reads as "could not read" forever (as the card asked), so an agent whose
folder was emptied by hand keeps its record and is told each time that Kosmos could not read the account, rather than
being moved to the main account for good. It stays on the main account meanwhile, so it fails safe, but the words
repeat. What would change my mind: evidence Claude Code ever deletes its config (then "missing" should be signed out).
Second: the uuid shape test means a Claude organization uuid that is not uuid-shaped would never be compared (email
alone decides), a looser match for one person's two organizations; real organizationUuid values are uuids.

## Tests
- engine/create.win32-samaccount-8489.test.js: org name then uuid, rename, other uuid, other email, signed out; a
  half-written and a missing Claude config (unreadable, true words); a Claude key with the same last four (changed),
  an old last-four record (same key matches, other last four does not); Gemini, Grok and codex keys by fingerprint,
  Grok and codex sign-in files mid-write (unreadable), codex sign-out (changed).
- engine/delete-leftover.win32-accountkeep-8478.test.js: end to end on the stand-in Task Scheduler, a half-written
  config at the task-only delete: true words, Start at login on the main account, the record kept with its identity,
  and back on its account once the config is whole.
- Negative control: each new test fails against origin/main's create/register/delete-leftover/openaiaccounts (with
  only an export of win32AccountIdentity appended so the unit tests can reach it).
