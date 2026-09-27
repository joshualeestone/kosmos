# wroteby-rounding-4084: wroteBy rounds its input like Node rounds stat.mtime

Card: #4084 (filed as a load flake; it is not load).

## Cause, measured (Node v26.8.1)
- recordWrite stores `stat.mtime.toISOString()`. Node builds `stat.mtime` by ROUNDING `mtimeMs`:
  utimes to x.9995 s gives mtimeMs ...999.5 and mtime (x+1).000 (x.9994 stays in x).
- wroteBy floored the raw `editedAtMs` to seconds. A caller passing the float `mtimeMs` for a write in the
  last half millisecond of a second got a different second from the record, so null (~1 in 2000 writes).
- The board is NOT affected: staleness passes `mtime.getTime()`, already rounded. The only caller with
  the raw float is create.test.js #323 (lines 2385/2393/2399), which is why it flaked. Load is irrelevant.

## Change
- engine/instructions.js wroteBy: `Math.floor(Math.round(editedAtMs) / 1000)`, so both forms match.
- engine/instructions.test.js: a boundary test (utimes to x.9996, the record as recordWrite writes it),
  both input forms, a control that the boundary really crosses, and a +1 s control that stays null.

## Rejected
- Changing the #323 test to pass mtime.getTime(): fixes one caller and leaves the trap for the next.
- Storing mtimeMs in the record: a schema change for a comparison fix.

## Weakest premise
Node's rounding is an implementation detail; if a future Node truncates instead, Math.round of the
float still agrees with a truncated record except in that same half millisecond, the other way round.
The boundary test's control arm fails loudly if Node's behaviour changes, rather than passing vacuously.
