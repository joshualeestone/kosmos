'use strict';
/**
 * #7108: cut text to at most `n` UTF-16 units without leaving half of a surrogate pair. `String.slice` counts units, so
 * a cut through an emoji kept its lead half; JSON.stringify writes that as a lone "\ud83d" escape, and a strict JSON
 * reader (the iPhone's JSONSerialization) refuses the whole answer that carries it. A trailing lead surrogate is
 * dropped, so the result is at most `n` units and always well-formed when the input was.
 */
function cutUnits(text, n) {
  const words = String(text).slice(0, n);
  const last = words.charCodeAt(words.length - 1);
  return last >= 0xD800 && last <= 0xDBFF ? words.slice(0, -1) : words;
}
module.exports = { cutUnits };
