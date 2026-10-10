'use strict';
/* #5804 (Liu Kang, 0.7.38): a Gemini agent launched on gemini-2.5-flash showed "Gemini 3.5 Flash" on its card. The card
   names the model the Gemini CLI recorded on its newest reply, and the CLI falls back to another model on a failure. The
   card now says when the model that answered differs from the one chosen. These run the page's own functions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}
const build = (pres) => new Function('cardStOf', grab('function modelLine(') + '\nreturn modelLine;')(() => ({ pres }));   // eslint-disable-line no-new-func

test('#5804: a running Gemini agent that answered on another model says which one was chosen', () => {
  const modelLine = build('on');
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.5 Flash', chosenModelName: 'Gemini 2.5 Flash' }),
    'Gemini 3.5 Flash (you chose Gemini 2.5 Flash)');
  // CONTROL: the same model, said either way, adds nothing.
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 2.5 Flash', chosenModelName: 'gemini  2.5 flash' }), 'Gemini 2.5 Flash');
  // No choice known (the launcher's default, or the read failed): the model alone, as before.
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.5 Flash', chosenModelName: null }), 'Gemini 3.5 Flash');
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.5 Flash' }), 'Gemini 3.5 Flash');
  // No model named yet: the provider, as before.
  assert.equal(modelLine({ runner: 'gemini', chosenModelName: 'Gemini 2.5 Flash' }), 'Gemini');
});

test('#5804: a stopped Gemini agent and a Grok agent are unchanged', () => {
  const stopped = build('off');
  assert.equal(stopped({ runner: 'gemini', modelName: 'Gemini 3.5 Flash', plannedModelName: 'Gemini 2.5 Flash', chosenModelName: 'Gemini 2.5 Flash' }),
    'Gemini 2.5 Flash', 'a stopped agent names what it will start on, with no "you chose"');
  const modelLine = build('on');
  assert.equal(modelLine({ runner: 'grok', modelName: 'Grok 4.6', chosenModelName: 'Grok 4' }), 'Grok 4.6', 'Grok is not part of this change');
});

test('#5804: the board sends the chosen model only for a running Gemini agent of ours, never the launcher default', () => {
  const src = SERVER.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /const chosenGeminiModel = \(a\) => \{\s*if \(!a\.isNamedOurs \|\| a\.runner !== 'gemini' \|\| !a\.modelName \|\| a\.state === STATE\.STOPPED\) return null;/);
  assert.match(src, /return planned && !planned\.isDefault \? modelDisplayName\(planned\.id\) : null;/);
  assert.match(src, /chosenModelName: chosenGeminiModel\(a\),/);
});
