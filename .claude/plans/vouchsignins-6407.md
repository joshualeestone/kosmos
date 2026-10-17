# vouchsignins-6407: the connect-this-browser tab arms from the snapshot's signins

Card: kosmos#6407. The tunnel half is kosmos-relay branch knock-6407.

## Why
The tunnel's pending snapshot now lists in `devices` only what knocked at this computer's gate (kosmos#6407). The
board's connect-this-browser tab (kosmos#5786 (b)) arms on a recent phone or browser sign-in, which usually happened
on the website and never knocked here, so it would never arm. The tunnel also writes `signins` (every phone or browser
row on the account, id and first_seen). The board reads both, through the same filters (its own sign-in, Not me,
denied, computers).

## Order
This merges FIRST. Alone it changes nothing: a tunnel that predates the field writes no `signins` (an empty list).

## Status
- [x] remote.js vouchRows(field) + vouchTick arming; test with controls (own sign-in, Not me, old); mutant caught
- [ ] Challenge loop, validation, proof, PR, merge
