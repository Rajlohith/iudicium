import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, setUnauthorizedHandler } from '../utils/api.js';
import { KEYS, remove } from '../utils/storage.js';

const AuthContext = createContext(null);

/**
 * Who is signed in. `status` is 'loading' until the server has answered,
 * then 'in' (with `user`) or 'out'.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  const clear = useCallback(() => {
    // Nothing from one person's session should be left behind for the next.
    Object.values(KEYS).forEach(remove);
    setState({ status: 'out', user: null });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    let active = true;
    api('/api/auth/me')
      .then((data) => active && setState(data.user ? { status: 'in', user: data.user } : { status: 'out', user: null }))
      .catch(() => active && setState({ status: 'out', user: null }));
    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, [clear]);

  /** Exchange the credential Google's button returned for a session. Throws with a readable message if refused. */
  const signIn = useCallback(async (credential) => {
    const data = await api('/api/auth/google', { method: 'POST', body: { credential } });
    setState({ status: 'in', user: data.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* signing out locally is what matters */
    }
    window.google?.accounts?.id?.disableAutoSelect?.();
    clear();
  }, [clear]);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
