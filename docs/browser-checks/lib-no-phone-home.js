'use strict';

/**
 * kosmos#5151: a browser check's fixture board never phones home, even when the check is run on its own.
 *
 * #4253 made every HARNESS point the install ping (AGENT_WORKFORCE_CREATED_URL) and the daily report
 * (AGENT_WORKFORCE_FEEDBACK_URL) at a dead local port, and a check run through tools/browser-checks.sh
 * inherits that. But a check is also run DIRECTLY (`node docs/browser-checks/<check>.js`), to reproduce a
 * red or prove a fix, and then nothing redirects it: its board minted an install id and told
 * installkosmos.com a new Mac install exists, carrying the checkout's version. On 2026-10-03 the install
 * listing showed 11 installs on 0.7.21, a version never served, all inside hours when agents ran single
 * checks against main AND the 0.7.21 cut's sandboxes ran: consistent with this path, not proven to be it
 * (a ping carries no source), which is why the harnesses and sandbox plists are marked as well.
 *
 * Requiring this file, before the check boots a board, sets both URLs to the same dead port the harness
 * uses (unless the caller already named one) and marks the run internal (KOSMOS_INTERNAL_RUN=1, read by
 * engine/createdbeacon.js isInternal()), so a ping that does get out is filed apart from real installs.
 * Every check spawns its board with `...process.env`, so the board inherits all three.
 * tools.no-phone-home-4253.test.js asserts every check that boots server.js requires this file, directly
 * or through lib-sandbox-home.js.
 */
process.env.AGENT_WORKFORCE_CREATED_URL = process.env.AGENT_WORKFORCE_CREATED_URL || 'http://127.0.0.1:9/api/created';
process.env.AGENT_WORKFORCE_FEEDBACK_URL = process.env.AGENT_WORKFORCE_FEEDBACK_URL || 'http://127.0.0.1:9/api/feedback';
process.env.KOSMOS_INTERNAL_RUN = '1';
