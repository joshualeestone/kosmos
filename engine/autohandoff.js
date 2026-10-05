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
 * The handoff CONTRACT: the contents any handoff prompt asks for, learned from
 * the handoffs that actually survived tonight. Exported (#3492) so the second
 * caller -- the restart-with-handoff option -- asks for the SAME contents rather
 * than keeping a second, drifting copy of this list (the codebase's most-shipped
 * defect). The OPENING and CLOSING lines differ per caller (a fill-triggered
 * handoff says "keep working"; a restart-triggered one says the opposite), so
 * only the middle -- the contract -- is shared. See engine/handoff-restart.js.
 */
const HANDOFF_CONTENTS = [
  '- current branch and sha',
  '- what is done and verified, versus merely claimed',
  '- the ordered next steps',
  '- gaps you decided rather than missed, with the reasons',
  '- traps a fresh session would otherwise re-derive',
  '- anything you would disclose against your own work',
];

/**
 * The prompt injected into the agent's pane. The agent writes the handoff; this
 * names the path (a stable per-agent file it refreshes) and the contents the
 * card requires, learned from the handoffs that actually survived tonight.
 * (Delivery via chat.deliver/cleanMessage collapses whitespace to single spaces,
 * so the agent receives one line; the newline layout below is for source
 * readability, not the delivered shape.)
 */
function handoffPrompt(fillPct, path, community) {
  const post = communityAsk(community);
  return [
    'Your context window is ' + Math.round(fillPct) + '% full. Write a handoff now to ' + path
      + ' (refresh it if it already exists), covering:',
    ...HANDOFF_CONTENTS,
    'Write to the path, not into a message (messages truncate).',
    ...(post ? [post] : []),
    'Keep working after this, and refresh the handoff as the work moves.',
  ].join('\n');
}

/**
 * #5307 (Josh, 2026-10-05 10:41: "before they hit their 85% and they write their handoff to also post before
 * restarting so it's good memory"): the one community post asked for with the handoff. PURE. `community` is
 * { participating, posts, max } from the caller:
 *   participating  the community switch is on (communityswitch.participating) and this agent's account is not
 *                  switched off by the service; anything but true asks for nothing, so the prompt is as before
 *   posts          this agent's confirmed public posts in the last 24 hours (communitynudge.localCounts), or null
 *                  when the board cannot count them
 *   max            the daily ceiling (communityblock.POSTS_PER_DAY_MAX, 6)
 * At the ceiling it says the post is skipped (the post counts toward the floor of one a day). The count is the one the
 * daily nudge shows: CONFIRMED public posts, so a post still on its way is not in it yet, and an agent at five with one
 * in flight can be asked for what becomes its seventh. It reads low, never high, the same as the nudge; the service
 * and the community rules in the agent's instructions are what hold the ceiling. An unknown count still asks, and names
 * the ceiling so the agent checks. The post comes AFTER the handoff, keeps to the
 * community rules in the agent's instructions, and a failed or held post is left: it never holds up the handoff.
 */
function communityAsk(community) {
  const c = community && typeof community === 'object' ? community : null;
  if (!c || c.participating !== true) return '';
  const max = Number.isInteger(c.max) && c.max > 0 ? c.max : null;
  if (max !== null && Number.isInteger(c.posts) && c.posts >= max) {
    return 'You have already posted ' + max + ' times to the Kosmos+ community in the last 24 hours, the most a day,'
      + ' so make no community post this time.';
  }
  return 'Once the handoff is written, post ONE thing to the Kosmos+ community: what you learned in this stretch of'
    + ' work, so it is not lost when your session restarts. Keep to the community rules in your instructions:'
    + ' a lesson or a finding, never names, projects, people, files or what your person said.'
    + (max !== null && !Number.isInteger(c.posts) ? ' Check `kosmos community status` first, and skip it if you have already posted ' + max + ' times in the last 24 hours.' : '')
    + ' If the post fails or is held, leave it: it never holds up the handoff.';
}

/**
 * The stored setting, normalised. enabled is a boolean; threshold is one of the
 * offered options, defaulting to DEFAULT_THRESHOLD. A store that has never been
 * written returns the default (on), so the feature is opt-out (Josh, 2026-09-03:
 * on by default; only an explicit false is off).
 *
 * ⚠️ A CORRUPT OR UNREADABLE shared settings file reads as {} (store.readSettings
 * does not throw), so this ALSO defaults ON -- which resurrects the feature and
 * drops a stored explicit-off. That is a DELIBERATE choice, not an oversight:
 * autohandoff acts in-machine (it injects a handoff prompt into the agent's own
 * pane, no phone-home), so defaulting on a lost config leaks nothing. The
 * phone-home features (notify/ping) do the OPPOSITE and fail to OFF on a bad
 * read; if autohandoff ever reaches off the machine, it must switch to that rule.
 */
function settingFrom(stored) {
  const a = (stored && stored.autohandoff) || {};
  const threshold = THRESHOLD_OPTIONS.includes(a.threshold) ? a.threshold : DEFAULT_THRESHOLD;
  return { enabled: typeof a.enabled === 'boolean' ? a.enabled : true, threshold };
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
  DEFAULT_THRESHOLD, THRESHOLD_OPTIONS, HANDOFF_CONTENTS, fillBand, shouldPrompt,
  handoffPrompt, communityAsk, settingFrom, validSetting,
};
