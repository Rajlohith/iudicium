/**
 * WHO MAY USE THIS SITE.
 *
 * Only Google accounts whose email address is listed here can sign in.
 * Anyone else is turned away at the login page, even with a valid Google
 * account. To give someone access, add their email and restart the server;
 * to remove access, delete the line (their open sessions stop working at
 * once, because the list is checked on every request).
 *
 * Emails are compared case-insensitively. Use the exact address of the
 * Google account (a Gmail address, or a Google Workspace / other address
 * that has been registered as a Google account).
 */
export const ALLOWED_EMAILS = [
  'your.name@gmail.com', // <-- replace with real addresses
  'rajlohith3@gmail.com',
  'rajlohith2004@gmail.com',
];
