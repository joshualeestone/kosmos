'use strict';
/**
 * A small fake DOM for the web suites that run web/index.html's SHIPPED functions
 * (#1704 PR4). Enough for the Kosmos picker and settings pane: element creation,
 * a tree (appendChild, append, replaceWith, textContent = '' clears it), attributes, dataset,
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

  function dropFocusIn(n) { for (let f = focused; f; f = f.parent) if (f === n) { focused = null; return; } }

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
      set textContent(v) { for (const c of this.children) dropFocusIn(c); this.ownText = String(v); this.children = []; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      replaceWith(n) {
        const p = this.parent; if (!p) return;
        const i = p.children.indexOf(this); if (i < 0) return;
        if (n.parent) { const j = n.parent.children.indexOf(n); if (j >= 0) n.parent.children.splice(j, 1); }
        n.parent = p; p.children[i] = n; this.parent = null;
        dropFocusIn(this);   // as a browser does: a removed node's focus goes to the body
      },
      append(...cs) { for (const c of cs) this.appendChild(c); },
      /* kosmos#4812: Element.after and previousElementSibling, as a browser does them. Moving a node takes it out
         of its old parent first, and a node that really moves loses any focus inside it (removal blurs). */
      get previousElementSibling() {
        const p = this.parent; if (!p) return null;
        const i = p.children.indexOf(this); return i > 0 ? p.children[i - 1] : null;
      },
      after(n) {
        const p = this.parent; if (!p || n === this) return;
        if (n.parent) { const j = n.parent.children.indexOf(n); if (j >= 0) { n.parent.children.splice(j, 1); dropFocusIn(n); } }
        n.parent = p; p.children.splice(p.children.indexOf(this) + 1, 0, n);
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
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
      /* Roughly what a browser lets take focus: a link with an href, an enabled form control, or anything given a
         tabIndex (the property, or a tabindex attribute), and nothing under a hidden ancestor. (Not modelled: display:none from CSS, inert, contenteditable, and a node not
         attached to the page, which a browser will not focus: insert before focusing.) */
      focus() {
        if (this.disabled || this.closest('[hidden]')) return;
        const can = (this.tagName === 'A' && !!this.href) || ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(this.tagName) || typeof this.tabIndex === 'number' || this.getAttribute('tabindex') !== null;
        if (can) focused = this;
      },
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

  /* kosmos#4812: a body whose classList the page reads (consolidated vs tab layout). Only the three calls used. */
  const bodyClasses = new Set();
  const body = create('body');
  body.classList = { contains: (c) => bodyClasses.has(c), add: (c) => { bodyClasses.add(c); }, remove: (c) => { bodyClasses.delete(c); } };
  const document = {
    body,
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
