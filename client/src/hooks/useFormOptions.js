import { useEffect, useState } from 'react';

import { api } from '../utils/api.js';

let cache = null;
let inflight = null;

/** The static dropdown data (benches, case types, years, ...), fetched once per page load. */
export function useFormOptions() {
  const [options, setOptions] = useState(cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cache) return undefined;
    let active = true;
    inflight ??= api('/api/form-options');
    inflight
      .then((data) => {
        cache = data;
        if (active) setOptions(data);
      })
      .catch((err) => {
        inflight = null;
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  return { options, error };
}
