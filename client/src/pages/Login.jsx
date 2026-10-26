import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../utils/api.js';

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';

/** Load Google's sign-in library once. */
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${GOOGLE_SCRIPT}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load Google sign-in.')));
  });
}

/** The whole landing page: the logo, and Google's sign-in button. Nothing else is reachable until you sign in. */
export default function Login() {
  const { signIn } = useAuth();
  const buttonRef = useRef(null);
  const [clientId, setClientId] = useState(undefined); // undefined = still asking, null = not configured
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api('/api/auth/config')
      .then((data) => active && setClientId(data.client_id))
      .catch(() => {
        if (active) {
          setClientId(null);
          setError('Could not reach the server. Is it running?');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let active = true;

    loadGoogleScript()
      .then(() => {
        if (!active || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          auto_select: false,
          callback: async ({ credential }) => {
            setError('');
            setBusy(true);
            try {
              await signIn(credential);
            } catch (err) {
              setError(err.message);
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 280,
        });
      })
      .catch((err) => active && setError(`${err.message} Check your internet connection and try again.`));

    return () => {
      active = false;
    };
  }, [clientId, signIn]);

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-card__logo" src="/iudicium-mark.svg" alt="iudicium logo" />
        <h1>iudicium.</h1>
        <p className="login-card__tag">Karnataka High Court case research</p>

        {clientId === null && !error && (
          <p className="login-card__error">
            Google sign-in is not set up yet. The site owner needs to add <code>GOOGLE_CLIENT_ID</code> to the server&rsquo;s{' '}
            <code>.env</code> file.
          </p>
        )}

        <div className="login-card__button" ref={buttonRef} aria-busy={busy} />
        {busy && <p className="login-card__note">Signing you in&hellip;</p>}

        {error && (
          <p className="login-card__error" role="alert">
            {error}
          </p>
        )}

        <p className="login-card__note">Access is limited to authorised accounts.</p>
      </div>
    </div>
  );
}
