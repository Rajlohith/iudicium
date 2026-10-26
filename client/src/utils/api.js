let onUnauthorized = null;

/** The auth context registers itself here so an expired session sends the person back to the login page. */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/** JSON fetch helper: throws an Error carrying the server's message on any non-2xx response. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    // A 401 from anywhere except the sign-in endpoints means the session ended (expired, signed out
    // elsewhere, or the account was removed from the allow-list).
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = data?.code;
    error.details = data?.details;
    throw error;
  }
  return data;
}
