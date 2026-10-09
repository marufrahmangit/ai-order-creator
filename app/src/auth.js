/**
 * The stored credential.
 *
 * What lives here is the username plus the APPLICATION password minted by
 * POST /token - never the account password, which is used for that one request
 * and then discarded. See "Login is a WordPress username and password" in
 * docs/DECISIONS.md.
 *
 * localStorage, persisting until logout: staff stay signed in across app
 * launches, which is the point of replacing wp-admin on a phone. The origin
 * serves nothing but this app, which is what makes that acceptable.
 */

const STORAGE_KEY = 'orderops.credential'

/**
 * localStorage throws rather than returning null in a few real situations -
 * Safari private browsing, storage disabled by policy, quota exceeded. None
 * of them should crash the app, so every access is guarded and a failure is
 * treated as "not signed in".
 */
function readRaw() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** @returns {{username: string, password: string, displayName: string, userId: number, uuid: string} | null} */
export function getCredential() {
  const raw = readRaw()
  if (!raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt or half-written value. Drop it rather than wedging the app on a
    // login screen that cannot be got past.
    clearCredential()
    return null
  }

  // Both fields are needed to build an Authorization header; anything else is
  // cosmetic. A payload missing either is useless, so treat it as absent.
  if (!parsed || typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
    clearCredential()
    return null
  }
  if (parsed.username === '' || parsed.password === '') {
    clearCredential()
    return null
  }

  return {
    username: parsed.username,
    password: parsed.password,
    displayName: typeof parsed.displayName === 'string' ? parsed.displayName : parsed.username,
    userId: Number(parsed.userId) || 0,
    // Identifies this application password server-side. Kept for the
    // revoke-on-logout route the API still owes us.
    uuid: typeof parsed.uuid === 'string' ? parsed.uuid : '',
  }
}

/**
 * Store the credential from a POST /token response.
 *
 * @param {{username: string, password: string, display_name?: string, user_id?: number, uuid?: string}} token
 */
export function setCredential(token) {
  const payload = {
    // The API echoes the canonical user_login back, which matters: the caller
    // may have signed in with an email address, and Basic auth needs the
    // username.
    username: token.username,
    password: token.password,
    displayName: token.display_name || token.username,
    userId: Number(token.user_id) || 0,
    uuid: token.uuid || '',
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Signing in still works for this session - api.js reads through
    // getCredential(), so a failed write only means it will not survive a
    // reload. Not worth blocking the login on.
  }
}

export function clearCredential() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do; a credential we cannot remove is one we could not
    // have written either.
  }
}

export function isSignedIn() {
  return getCredential() !== null
}
