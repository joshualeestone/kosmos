# fed-bound-3844: outside rows' day budget survives a restart; the minute note is said once a day

Card: kosmos#3844 (deferred from the #3311 federation review, round 19).

## 1. Minute-budget notes were unbounded
**Call:** the "more messages than Kosmos keeps in a minute" note is said at most once a day per room (per seat run; a restart can say it once more), and it now says so ("Kosmos says this once a day").
**Rejected:** once per budget state change (a peer hovering at the rate flips state every minute, the same 1,440).
**Test:** a peer over the rate in three windows gets one note, and a new UTC day may say it again. Control (once per window) fails by name.

## 2. Only rate was bounded, and the day reset on restart
**Call:** when a seat's day starts it is SEEDED from the message log, the durable record, via `messages.externalKeptOn(projectId, day)`: rows and bytes already kept from outside in that room that UTC day, charged as STORED. That is never more than the live counter charged (it charges the raw words, and a row externalPost refuses is charged but not stored), so after a restart the room can get back only bytes that were never kept; stored rows and bytes stay within 2,000 and 2 MiB per room per UTC day (round 1 corrected my first wording, which claimed the two charges matched). A board restart, an update or stop/ensure no longer grants a fresh 2 MiB. So the bound is now a real calendar-day bound: 2,000 rows and 2 MiB per room per UTC day.
**Rejected, and why: a total cap on stored rows (drop the oldest outside rows).** The message log is one append-only file for every conversation, and it has no retention BY A RECORDED DECISION (engine/messages.js: "retention is the screens chunk's call"; dropping rows changes the #185 nudge sweep and its at-most-once rows, and the #562 read cache treats any rewrite as a full re-parse). A cap for outside rows alone would be the first rewrite of that file, which should come with retention, not ahead of it. What is left: a peer can still add up to 2 MiB a day to one room, indefinitely, the same growth a busy local room has.
**Weakest premise:** that 2 MiB a day per room is an acceptable indefinite growth rate until retention lands. If it is not, the next step is retention for the log, not a special case here.
**Unknown:** a log that cannot be read seeds zero (the send path's fail-open trade), so an unreadable log does not refuse every outside message.
**Tests:** a seat seeded 3 rows short of the day keeps 3 and then notes; the byte half is seeded too; a null seed counts from zero; externalKeptOn counts one room, one day, charged as stored. Control (no seed) fails the first two by name. server.federation-3311.test.js asserts the board wires externalKeptOn (fedseats.wired); control (the wiring removed) fails by name.

## Round 1 review (opus): 4 NITs
- [NIT] the comments and plan said the seed is charged the way fedseats charges; it is charged as stored, which is at most the live charge. FIXED: both now say that, and why the stored bound still holds.
- [NIT] a second flood in the same day is dropped with no further note. DEFERRED: disclosed in the note itself ("Kosmos says this once a day"); a dropped-count summary is a possible follow-up.
- [NIT] the externalKeptOn test read "today" from the clock before the rows were stamped (a run across midnight UTC). FIXED: the day comes from the stored row.
- [NIT] the null-seed test cannot catch a missing seed. NO CHANGE: it guards only the fail-open path, as its name says; the rows- and bytes-seed tests are the controls for the seed.

## Round 2 review (sonnet): 2 NITs
- [NIT] the seat-shape comment did not name inday. FIXED: it names inbound and inday and their fields.
- [NIT] the externalKeptOn test computed bytes with .length on ASCII only. FIXED: a multibyte name and word, expected via Buffer.byteLength (so a .length implementation would fail).

## Round 3 review (opus): 1 NIT
- [NIT] two older budget comments still said rows cannot grow "without end", which the recorded trade contradicts. FIXED: both say bounded per UTC day, not in total.
