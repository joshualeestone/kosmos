'use strict';
/* kosmos#8258: a moment as this computer's own date and clock, for text an agent may copy a date from. */
function localStamp(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
    + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}

module.exports = { localStamp };
