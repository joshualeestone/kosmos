'use strict';
/**
 * A small fake DOM for the web suites that run web/index.html's SHIPPED functions
 * (#1704 PR4). Enough for the Kosmos picker and settings pane: element creation,
 * a tree (appendChild, append, textContent = '' clears it), attributes, dataset,
 * listeners with bubbling, click on a checkbox, focus, and the selectors those
 * functions use ('.class', 'tag[type="x"]', a bare tag, '[hidden]').
 *
 * A selector it does not know answers nothing rather than guessing, so a function
 * that starts using a new selector fails its test instead of passing vacuously.
 */

function makeDom() {
  let focused = null;
  const byId = {};

  function matches(n, sel) {
    if (sel === '[hidden]') return n.hidden === true;
    if (sel.startsWith('.')) return String(n.className).split(/\s+/).includes(sel.slice(1));
    const typed = /^(\w+)\[type="(\w+)"\]$/.exec(sel);
    if (typed) return n.tagName === typed[1].toUpperCase() && n.type === typed[2];
    if (/^\w+$/.test(sel)) return n.tagName === sel.toUpperCase();
    return false;
  }

  function create(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '',
      children: [],
      parent: null,
      className: '',
      type: '',
      value: '',
      title: '',
      hidden: false,
      disabled: false,
      checked: false,
      indeterminate: false,
      dataset: {},
      attrs: {},
      listeners: {},
      ownText: '',
      get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(''); },
      set textContent(v) { this.ownText = String(v); this.children = []; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      append(...cs) { for (const c of cs) this.appendChild(c); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      dispatch(t) {
        const ev = { type: t, target: this, stopPropagation() { ev.stopped = true; } };
        for (let n = this; n && !ev.stopped; n = n.parent) for (const fn of n.listeners[t] || []) fn(ev);
      },
      click() {
        if (this.disabled) return;
        if (this.tagName === 'INPUT' && this.type === 'checkbox') { this.checked = !this.checked; this.dispatch('change'); return; }
        this.dispatch('click');
      },
      focus() { focused = this; },
      select() {},
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } };
        walk(this);
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      closest(sel) { for (let n = this; n; n = n.parent) if (matches(n, sel)) return n; return null; },
    };
    return node;
  }

  const document = {
    createElement: create,
    getElementById: (id) => byId[id] || null,
    get activeElement() { return focused; },
  };

  /* Register an element the page would have in its markup. */
  function add(id, tag = 'div', props = {}) {
    const n = create(tag);
    Object.assign(n, props);
    n.id = id;
    byId[id] = n;
    return n;
  }

  return { document, add, create, focused: () => focused };
}

module.exports = { makeDom };
