# qfnspin-6756: pin the lib functions the relay pre-push loads by name

Addresses #6756 (follow-up to #7703, offered on the card).

## Finished means
1. Renaming any of the six functions kosmos-relay's .githooks/pre-push loads by name (its QFNS list), or the two it
   calls only when defined, fails `tools/test-prepush-wait-6756.sh` by name.
2. The arm can fail: an in-suite control (a renamed copy) and a hand control (renaming one in the real lib) both go red.
3. PR open, CI green by name, signed off at its head.

## Change
Arm 11 in the text-only part of `tools/test-prepush-wait-6756.sh`, so it runs on Linux and macOS CI (test:shell). Each
name is checked in a fresh `/bin/bash` that loads the lib as the hook does (`set +u; . lib`), so the file's own stubs of
`kosmos_refuse_if_suite_live` and friends cannot satisfy it, and a lib bash 3.2 cannot load fails every name.

## Why the two optional names
The hook calls `kosmos_refuse_if_cut_live` and `kosmos_refuse_if_light_side_live` behind `command -v`. A rename there
does not refuse; it silently drops the release and light-side checks from the push's queue exit, which is the quieter
and worse failure.

## Not done, and why
- The hook's list is copied, not read: the relay repo is not in kosmos CI. A new name in the hook needs this list
  updated by hand; the comment says so.
- Signatures are not pinned (argument order of the refuse functions). A rename is the likely break; a signature change
  would show in the relay's own tests.

## Weakest part
The copy of the list can drift from the hook in the other direction (the hook gains a name). Would change my mind: a
relay-side test that reads this list, if the relay ever runs kosmos's tests.
