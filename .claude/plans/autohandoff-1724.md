# autohandoff-1724: auto-write a handoff when an agent's context window fills

kosmos#1724. Josh, 2026-08-31 22:55: "Maybe we add auto handoff when context windows fill as part
of the automation too." Third control in Settings > Automation (#1722 creates the section; #1722 is
unowned tonight, so THIS card creates the section as the first thing to land in it, and the heartbeat
control is added later).

## Decisions I own (Splinter, 2026-08-31: decide the threshold and file format yourself, document it,
## Josh can override, do not come back for approval)

- **Threshold: default 85%, adjustable.** Options in Settings: 75 / 80 / 85 / 90 / 95%, plus Off.
  85% fires well before the wall (Josh's spec suggested ~85). Josh can change it in Settings.
- **The AGENT writes the handoff, prompted by the product** (not the product writing it). Angel's
  handoff survived because she wrote it from inside her own session; the product cannot know an
  agent's done-vs-claimed or its self-disclosures. So the mechanism PROMPTS the agent to write.
- **Write to a PATH ON DISK, never a message.** Per the spec and the truncation evidence: a handoff
  that only exists in a message is lost. Path: `<data-root>/handoffs/<safeKey(agent)>.md`, a STABLE
  per-agent path that is REFRESHED (not timestamped), so there is one current handoff per agent that
  updates as work continues (the spec's "refresh as work continues").
- **Fire per-iteration while over threshold, not once.** At 96% there may be no end to write from.
  Re-prompt each poll the agent is at/over threshold, but do not spam within a single poll.

## Detection (already exists, reuse it)
engine/status.js computes each agent's context-window fill % from the session transcript and per-model
CONTEXT_LIMITS (limitFor). The monitor reads that value; a threshold check is a comparison, no new
detection needed. This is why #1724 is bounded and #1722's heartbeat is not: the hard part (knowing
the number) is already solved here, whereas #1722's "which agents are working" detection is not.

## The mechanism
- A periodic check (on the same poll that computes agent status) reads each running agent's ctx fill.
- If auto-handoff is enabled AND the agent's fill >= threshold: inject a handoff prompt into the
  agent's pane, naming the path and the required contents.
- De-dup: record the last ctx-band an agent was prompted at, so it is prompted when it crosses the
  threshold and re-prompted as it climbs, not spammed every poll at the same level.

## The prompt / handoff contents (per the spec)
The injected prompt tells the agent to write to its path now, covering: current branch + sha; what is
done and verified vs merely claimed; the ordered next steps; gaps decided rather than missed, with
reasons; traps a fresh session would re-derive; anything disclosed against the agent's own work.

## Capture (Settings > Automation, my lane, #1668 pattern)
- Create the Settings > Automation section (does not exist yet).
- Auto-handoff control: an on/off toggle + a threshold selector, with a plain-language line and a
  short note that Kosmos will ask the agent to save its progress as its context fills.
- Persist via engine/store.js readSettings/writeSettings (the account-level store added in #1668),
  and GET/POST /api/settings (extended).

## Deliberately not in this card
- The heartbeat control (#1722) and the recommender (#1723, PigeonPete's) are separate controls in
  the same section, added by their own cards.
- Nothing touches the dev fleet's com.stonesyndicate.builder-progress.

## Verification
Demonstrate the trigger: an agent at/over threshold gets the handoff prompt; below threshold, or with
auto-handoff off, it does not. Store round-trip. Settings UI render-verified. Em-dash clean.
