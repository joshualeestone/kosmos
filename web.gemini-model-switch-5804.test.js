'use strict';
/* #5804 (Liu Kang, 0.7.38): a Gemini agent launched on gemini-2.5-flash showed "Gemini 3.5 Flash" on its card. The card
   names the model the Gemini CLI recorded on its newest reply, and the CLI falls back to another model on a failure. The
   card now says "(set to X)" when the board sends settingModelName (engine/geminimodelswitch.js decides when). These
   run the page's own functions. */
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

test('#5804: a running Gemini agent the board marks names the model it is set to', () => {
  const modelLine = build('on');
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.5 Flash', settingModelName: 'Gemini 2.5 Flash' }),
    'Gemini 3.5 Flash (set to Gemini 2.5 Flash)');
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.5 Flash', settingModelName: null }), 'Gemini 3.5 Flash');
  assert.equal(modelLine({ runner: 'gemini', modelName: 'Gemini 3.5 Flash' }), 'Gemini 3.5 Flash');
  assert.equal(modelLine({ runner: 'gemini', settingModelName: 'Gemini 2.5 Flash' }), 'Gemini', 'no model named yet: the provider');
});

test('#5804: a stopped Gemini agent and a Grok agent are unchanged', () => {
  const stopped = build('off');
  assert.equal(stopped({ runner: 'gemini', modelName: 'Gemini 3.5 Flash', plannedModelName: 'Gemini 2.5 Flash', settingModelName: 'Gemini 2.5 Flash' }),
    'Gemini 2.5 Flash', 'a stopped agent names what it will start on, with no note');
  const modelLine = build('on');
  assert.equal(modelLine({ runner: 'grok', modelName: 'Grok 4.6', settingModelName: 'Grok 4' }), 'Grok 4.6', 'Grok is not part of this change');
});

test('#5804: the board sends settingModelName only for a running Gemini agent of ours, decided by the engine', () => {
  const src = SERVER.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /const settingGeminiModel = \(a\) => \(a\.isNamedOurs && a\.runner === 'gemini' && a\.modelName && a\.state !== STATE\.STOPPED\)\s*\? require\('\.\/engine\/geminimodelswitch'\)\.settingModelName\(a\.sessionName\)\s*: null;/);
  assert.match(src, /settingModelName: settingGeminiModel\(a\),/);
});
