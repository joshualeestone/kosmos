'use strict';

/**
 * #1724: auto-write a handoff when an agent's context window fills.
 *
 * This module is the PURE core: the decision (should this agent be prompted to
 * write a handoff now?) and the prompt text. It does no I/O. The poll loop
 * supplies the live context-fill % (engine/status.js already computes it) and,
 * on a true decision, injects handoffPrompt() into the agent's pane. Keeping
 * the decision pure is what lets it be tested without a real agent or a clock.
 *
 * Josh, 2026-08-31: "add auto handoff when context windows fill." The AGENT
 * writes the handoff (the product cannot know its done-vs-claimed); the product
 * only decides WHEN and tells it WHERE and WHAT.
 */

// Default trigger, and the choices offered in Settings > Automation. 85% fires
// well before the wall, per the card. Josh can change it; this is the default.
const DEFAULT_THRESHOLD = 85;
const THRESHOLD_OPTIONS = [75, 80, 85, 90, 95];

/**
 * The 5-point band a fill sits in, for de-dup. We prompt when an agent crosses
 * the threshold and again as it climbs into a higher band, but NOT every poll at
 * the same level (that would spam a pane already told to hand off). 100 is its
 * own band so a pegged agent is prompted once at the wall, not repeatedly.
 */
function fillBand(fill) {
  if (fill >= 100) return 100;
  return Math.floor(fill / 5) * 5;
}

/**
 * Should the product prompt this agent to write a handoff now?
 * @param enabled   auto-handoff turned on in Settings
 * @param threshold the configured trigger %, e.g. 85
 * @param fill      the live context-window fill %, from status.js
 * @param lastBand  the band this agent was last prompted at (null if never)
 *
 * ⚠️ Fires per-iteration while climbing (the card's rule: at 96% there may be no
 * end to write from), but only once per band, so a steady 86% is prompted once.
 */
function shouldPrompt(enabled, threshold, fill, lastBand) {
  if (!enabled) return false;
  if (typeof fill !== 'number' || !isFinite(fill)) return false;
  if (typeof threshold !== 'number' || !isFinite(threshold)) return false;
  if (fill < threshold) return false;
  const band = fillBand(fill);
  if (lastBand === null || lastBand === undefined) return true;
  return band > lastBand;
}

/**
 * The prompt injected into the agent's pane. The agent writes the handoff; this
 * names the path (a stable per-agent file it refreshes) and the contents the
 * card requires, learned from the handoffs that actually survived tonight.
 * (Delivery via chat.deliver/cleanMessage collapses whitespace to single spaces,
 * so the agent receives one line; the newline layout below is for source
 * readability, not the delivered shape.)
 */
function handoffPrompt(fillPct, path) {
  return [
    'Your context window is ' + Math.round(fillPct) + '% full. Write a handoff now to ' + path
      + ' (refresh it if it already exists), covering:',
    '- current branch and sha',
    '- what is done and verified, versus merely claimed',
    '- the ordered next steps',
    '- gaps you decided rather than missed, with the reasons',
    '- traps a fresh session would otherwise re-derive',
    '- anything you would disclose against your own work',
    'Write to the path, not into a message (messages truncate). Keep working after this, and'
      + ' refresh the handoff as the work moves.',
  ].join('\n');
}

/**
 * The stored setting, normalised. enabled is a boolean; threshold is one of the
 * offered options, defaulting to DEFAULT_THRESHOLD. A store that has never been
 * written returns the safe default (off), so the feature is opt-in.
 */
function settingFrom(stored) {
  const a = (stored && stored.autohandoff) || {};
  const threshold = THRESHOLD_OPTIONS.includes(a.threshold) ? a.threshold : DEFAULT_THRESHOLD;
  return { enabled: a.enabled === true, threshold };
}

/**
 * Is a POSTed auto-handoff patch valid? enabled must be a boolean and threshold
 * must be one of the offered options. Defense in depth on the write path, the
 * same posture as validTimeZone: the UI only offers valid values, so a bad one
 * is a direct API call and is refused rather than persisted.
 */
function validSetting(a) {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.enabled !== 'boolean') return false;
  if (!THRESHOLD_OPTIONS.includes(a.threshold)) return false;
  return true;
}

module.exports = {
  DEFAULT_THRESHOLD, THRESHOLD_OPTIONS, fillBand, shouldPrompt, handoffPrompt,
  settingFrom, validSetting,
};
