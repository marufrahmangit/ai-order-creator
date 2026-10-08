/**
 * A DOM just real enough to construct the views, plus the loader that makes
 * src/ importable outside Vite.
 *
 * Shared by the test files that need to RUN a view rather than read its source.
 * Deliberately crude: it only has to satisfy dom.js's el() and the handful of
 * properties the views set directly. If a view ever needs more of the DOM than
 * this provides, that is worth finding out about.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

export function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [], listeners: {}, dataset: {}, attributes: {},
    className: '', textContent: '', id: '', value: '', type: '',
    disabled: false, hidden: false, open: false, title: '', placeholder: '',
    href: '', rows: 0, min: 0, step: 0, required: false, spellcheck: false,
    options: [],
    parentNode: null,
    append(...kids) {
      for (const kid of kids) {
        if (kid && typeof kid === 'object') kid.parentNode = this
        this.children.push(kid)
        if (kid && typeof kid === 'object' && 'tagName' in kid && this.tagName === 'SELECT') {
          this.options.push(kid)
        }
      }
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) },
    removeEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value) },
    replaceChildren() { this.children = []; this.options = [] },
    // Really detaches, so a test can tell whether a banner or sheet is still up.
    remove() {
      if (!this.parentNode) return
      this.parentNode.children = this.parentNode.children.filter((kid) => kid !== this)
      this.parentNode = null
    },
    focus() {}, select() {},
    querySelector: () => null,
    // Real enough to observe: pwa.js marks body while a banner is up, and sets
    // the banner's measured clearance as a custom property on it.
    classList: (() => {
      const set = new Set()
      return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) }
    })(),
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = String(value) },
      removeProperty(name) { delete this.props[name] },
      getPropertyValue(name) { return this.props[name] ?? '' },
    },
  }
}

/** Installs the globals the views touch. Safe to call more than once. */
export function installDom() {
  globalThis.document = {
    createElement: makeNode,
    getElementById: () => makeNode('div'),
    body: makeNode('body'),
    addEventListener() {},
  }

  const store = new Map()
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }

  globalThis.window = {
    localStorage: storage,
    sessionStorage: storage,
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    scrollTo() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    location: { reload() {}, origin: 'http://localhost:5173' },
  }

  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  globalThis.CustomEvent = class CustomEvent {
    constructor(type) { this.type = type }
  }

  // api.js refuses to reach the network without one.
  storage.setItem('orderops.credential', JSON.stringify({ username: 'staff', password: 'pw' }))

  return { store, storage }
}

/**
 * Copies the given src/ modules to a temp directory with Vite-only syntax
 * substituted, and returns an import function for them.
 */
export function loadable(relPaths) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'orderops-views-'))

  for (const rel of relPaths) {
    const to = path.join(work, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(
      to,
      fs.readFileSync(path.join(SRC, rel), 'utf8')
        .replace(/import\.meta\.env\.VITE_API_BASE/g, JSON.stringify('http://localhost/wp-json/aioc/v1'))
        .replace(/import\.meta\.env\.PROD/g, 'false')
        // styles.css has no meaning outside Vite.
        .replace(/^import '\.\/styles\.css'$/m, ''),
    )
  }

  return {
    work,
    load: (rel) => import(pathToFileURL(path.join(work, rel)).href),
    cleanup: () => fs.rmSync(work, { recursive: true, force: true }),
  }
}

/** The modules every view test needs. */
export const VIEW_MODULES = [
  'dom.js', 'auth.js', 'api.js', 'meta.js', 'format.js', 'phone.js', 'pwa.js',
  'reorder.js', 'quantity.js', 'exit-guard.js',
  'views/login.js', 'views/orders.js', 'views/order-form.js',
  'views/product-picker.js', 'views/last-order.js',
]

/** Depth-first search over the shim's node tree. */
export function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const kid of node.children || []) {
    const hit = findNode(kid, predicate)
    if (hit) return hit
  }
  return null
}

/** Dispatches to the listeners the shim recorded. */
export function fire(node, type, event = {}) {
  for (const fn of node.listeners[type] || []) {
    fn({ target: node, preventDefault() {}, ...event })
  }
}

export const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))
