/**
 * sessionStorage wrappers. Everything is wrapped in try/catch because
 * storage can be full, disabled, or hold something that is no longer valid JSON.
 */

export const KEYS = {
  detailedResults: 'detailedSearchResults',
  quickResults: 'quickSearchResults',
  assistantPrefill: 'assistantPrefill',
  assistantSession: 'assistantSession',
};

export function readJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`Could not save "${key}" to sessionStorage:`, err);
    return false;
  }
}

export function remove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
