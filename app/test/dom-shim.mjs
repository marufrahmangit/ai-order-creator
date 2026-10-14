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
    /*
     * A real DOM keeps `class` and `className` as one thing, and `id`
     * likewise. The shim used to store them only in `attributes`, so a node
     * built with setAttribute('class', ...) - which is the only way to build an
     * SVG node, since el() cannot - looked classless to every test helper.
     */
    setAttribute(name, value) {
      this.attributes[name] = String(value)
      if (name === 'class') this.className = String(value)
      if (name === 'id') this.id = String(value)
    },
    replaceChildren() { this.children = []; this.options = [] },
    // Really detaches, so a test can tell whether a banner or sheet is still up.
    remove() {
      if (!this.parentNode) return
      this.parentNode.children = this.parentNode.children.filter((kid) => kid !== this)
      this.parentNode = null
    },
    focus() {}, select() {},
    querySelector: () => null,
    /*
     * Real enough to observe, and KEPT IN STEP WITH className, as a browser
     * does. pwa.js marks body while a banner is up; toast.js adds a leaving
     * class that a test has to be able to see. Before this they were separate,
     * so classList.add() was invisible to anything reading className.
     */
    get classList() {
      const node = this
      const parts = () => String(node.className).split(' ').filter(Boolean)
      return {
        add: (...cls) => {
          const next = new Set([...parts(), ...cls])
          node.className = [...next].join(' ')
        },
        remove: (...cls) => {
          node.className = parts().filter((c) => !cls.includes(c)).join(' ')
        },
        contains: (c) => parts().includes(c),
      }
    },
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
  const body = makeNode('body')

  globalThis.document = {
    createElement: makeNode,
    // toast.js draws its marks as SVG, which createElement cannot make. The
    // namespace is not modelled - only that the call works and yields a node.
    createElementNS: (_ns, tag) => makeNode(tag),
    getElementById: () => makeNode('div'),
    body,
    /*
     * Enough of a selector engine for `.class`, which is all anything here
     * asks for - toast.js looks up its own layer this way so it creates one
     * rather than many. Walks the real body tree, so a test can tell whether
     * the layer was reused or duplicated.
     */
    querySelector(selector) {
      const cls = /^\.([\w-]+)$/.exec(String(selector))?.[1]
      if (!cls) return null
      const walk = (node) => {
        if (!node || typeof node !== 'object') return null
        if (String(node.className).split(' ').includes(cls)) return node
        for (const kid of node.children || []) {
          const hit = walk(kid)
          if (hit) return hit
        }
        return null
      }
      for (const kid of body.children) {
        const hit = walk(kid)
        if (hit) return hit
      }
      return null
    },
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
  'reorder.js', 'quantity.js', 'exit-guard.js', 'toast.js',
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
