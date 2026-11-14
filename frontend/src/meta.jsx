import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// Enum values and environment info shared by every page.
const MetaContext = createContext({ enums: {}, db_type: '' });

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState({ enums: {}, db_type: '' });
  useEffect(() => {
    api.get('/meta').then(setMeta).catch(() => {});
  }, []);
  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);
export const useEnum = (name) => useMeta().enums[name] || [];
