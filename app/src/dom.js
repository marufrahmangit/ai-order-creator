/**
 * Minimal DOM helpers.
 *
 * Everything in this app builds nodes and sets textContent rather than
 * assembling innerHTML. Order data is staff-entered free text - customer
 * names, addresses, notes pasted from messages - so string-built markup would
 * be an injection waiting to happen. textContent cannot be coaxed into
 * executing anything.
 */

/**
 * @param {string} tag
 * @param {object} [attrs] Properties, plus `class`, `text`, `html` is NOT supported.
 * @param {Array<Node|string>} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue

    if (key === 'class') {
      node.className = value
    } else if (key === 'text') {
      node.textContent = String(value)
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value)
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key in node) {
      node[key] = value
    } else {
      node.setAttribute(key, String(value))
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }

  return node
}

export function clear(node) {
  node.replaceChildren()
}

/**
 * Debounce, returning a function that also exposes cancel().
 *
 * Used by the order list's search box so a burst of keystrokes produces one
 * request rather than one per character.
 */
export function debounce(fn, waitMs) {
  let timer = 0

  const wrapped = (...args) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), waitMs)
  }

  wrapped.cancel = () => window.clearTimeout(timer)

  return wrapped
}
