# swarm-offline-3564: a stopped swarm's board row carries its swarm settings

Card: kosmos#3564. Found by Mona Lisa in review of the swarm UI (#3690): the offline row built in
server.js (/api/status, agents with no pane) had no `swarm` key, and engine/status.js sets it only for
running panes. So a stopped or paused-and-exited swarm was drawn as a plain agent: its page offered the
provider switch (which create.js refuses for a swarm) and Members gave it no On/Off.

## What
- `engine/swarm.js` `offlineCardField(profile)`: `cardField(profile, () => null)`. The settings
  (maxHelpers, dailyTokenLimit, active, pausedBecause) with `metered: false`, `tokensToday: 0`,
  `activeHelpers: 0`, `helperTokenRatio: null`, the same unmeasured shape a running swarm with no
  transcript already gets. Null for an ordinary agent.
- `server.js` offline row: `swarm: offlineCardField(profile)`.

## Decided
- No transcript read for an offline swarm: Mona asked for settings with `metered: false`, and it keeps
  the offline row cheap on every poll. `metered: false` already tells the screen the zeros are unmeasured.
- The daily-limit sweep is unaffected: it reads `safeRoster()` (running panes), never the offline rows.

## Weakest premise
- Tokens a swarm spent today before it stopped are not shown on its offline row. If the screen wants
  them (a swarm stopped at its limit), reading the transcript here is the follow-up.

## Verification
- `server.swarm-3564.test.js`: a stopped, person-paused swarm's offline row has the settings and
  `metered: false`; a plain stopped agent has `swarm: null`; controls that both rows are the offline ones.
  Removing the server line turns it RED.
