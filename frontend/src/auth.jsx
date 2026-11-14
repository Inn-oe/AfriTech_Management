import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

// Which permission group each API resource belongs to (mirrors auth.py on the server,
// which is where permissions are actually enforced).
const MODULE_OF = {
  customers: 'customers',
  quotations: 'sales', invoices: 'sales', payments: 'sales',
  inventory: 'inventory', suppliers: 'inventory', pricing: 'inventory',
  financial: 'finance', 'financial-records': 'finance', 'financial-categories': 'finance',
  activities: 'operations', 'activity-types': 'operations', 'fuel-records': 'operations',
  'mileage-records': 'operations', journeys: 'operations', locations: 'operations',
  dashboard: 'dashboard', users: 'admin', company: 'admin', 'audit-log': 'admin',
};
const LEVEL = { read: 1, write: 2 };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, session: null });

  const apply = useCallback((data) => {
    setState({ loading: false, session: data?.user ? data : null });
    return data;
  }, []);

  const refresh = useCallback(() => api.get('/auth/me').then(apply).catch(() => apply(null)), [apply]);

  useEffect(() => {
    refresh();
    const expired = () => apply(null);
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, [refresh, apply]);

  const value = useMemo(() => {
    const s = state.session;
    const permissions = s?.permissions || {};
    const can = (module, level = 'read') => (LEVEL[permissions[module]] || 0) >= LEVEL[level];
    return {
      loading: state.loading,
      user: s?.user || null,
      company: s?.company || null,
      roles: s?.roles || [],
      can,
      // endpoint like "/suppliers" -> may the user create/edit/delete there?
      canWrite: (endpoint) => can(MODULE_OF[String(endpoint).split('/')[1]] || 'admin', 'write'),
      login: (body) => api.post('/auth/login', body).then(apply),
      signup: (body) => api.post('/auth/signup', body).then(apply),
      logout: () => api.post('/auth/logout').catch(() => {}).then(() => apply(null)),
      refresh,
    };
  }, [state, apply, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
