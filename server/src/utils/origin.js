/**
 * Is a browser request really from this site?
 *
 * Browsers attach an `Origin` header to cross-site requests. A request whose
 * Origin names a different host than the one the page was served from is
 * refused (this stops another website from making your browser act on your
 * signed-in session). Requests with no Origin (curl, server-to-server) pass
 * this check; they have no browser session to hijack.
 *
 * Behind a reverse proxy the `Host` header can be rewritten to the backend's
 * own address, so when TRUST_PROXY is on, `X-Forwarded-Host` (the host the
 * browser actually used) is accepted too.
 */
export function isSameSite(originHeader, headers, trustProxy = false) {
  if (!originHeader) return true;

  let originHost;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return false; // malformed Origin
  }

  const hosts = [headers.host];
  if (trustProxy && headers['x-forwarded-host']) hosts.push(String(headers['x-forwarded-host']).split(',')[0].trim());
  return hosts.includes(originHost);
}
