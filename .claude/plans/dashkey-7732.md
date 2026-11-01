# dashkey-7732: a random key starting with - no longer breaks the service-keys test

Card: kosmos#7732. Line 46 greps for a random base64url key; a key starting with - is read as an option (about 1 run in 64) and can stop a cut.

## Finished looks like
The test matches the key as a fixed string after --, so any key works. Nothing else builds a pattern from a key: swept the test and tools/lib/service-keys-live.sh.

## Decided
grep -qF -- rather than -e: the key is data, so fixed-string too. Rejected: a seed or a retry, which would hide it.

## Weakest premise
None worth naming: one line, test only.
