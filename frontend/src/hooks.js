import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Load data from the API; returns { data, loading, error, reload }.
export function useApi(url, initial = null) {
  const [state, setState] = useState({ data: initial, loading: !!url, error: null });

  const reload = useCallback(async () => {
    if (!url) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(url);
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }));
    }
  }, [url]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}
