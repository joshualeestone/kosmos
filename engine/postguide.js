'use strict';

/*
 * kosmos#8735 slice 4: what a room and a dialogue render, printed by `kosmos post --how` (both CLIs), in a module
 * that requires nothing, as engine/claimguide.js and engine/taskguide.js are. The working rules (engine/defaults.js,
 * "Send readable messages, not a wall of text") keep the rule: write formatted from the first message, the two
 * things that fail silently (raw HTML, a `>` line in a room), the shell trap and the heredoc. This is the list.
 * Why: a new agent's instructions were over Claude Code's 40,000-character warning (kosmos#8735).
 */

function guideText() {
  return [
    'What a Kosmos room and your dialogue with the person render. The rule is in your instructions, under',
    '"Send readable messages, not a wall of text".',
    '',
    // Both paragraphs, from "**What a room shows you:**" to "never in a room.", are word for word from doctrine 60, so a running
    // agent's changes file leaves them out as moved (engine/instructionreread.js, movedPost).
    '**What a room shows you:** short paragraphs with a blank line between them,',
    'headings written with `#` to `######`, **bold**, *italic*, ~~strikethrough~~,',
    '`code` and fenced blocks, lists, tables and emoji. An address starting `http://` or `https://` becomes a link, and a',
    '`[label](address)` link shows its address after the label.',
    '',
    '**What it does not, so do not reach for these:** anything written as raw',
    'HTML is shown the way you typed it, not turned into a page. And a line that',
    'starts with `>` becomes a quote in your dialogue with the person but stays',
    'literal text in a project room, so lean on it only there, never in a room.',
    '',
    'Each part of a heading or a list shows as one only when it starts on its own line, so give anything with',
    'structure in the form your instructions give under "Formatted messages need line breaks".',
  ].join('\n');
}

module.exports = { guideText };
