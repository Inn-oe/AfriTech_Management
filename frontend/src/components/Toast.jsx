import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((x) => x.id !== id)), []);

  const notify = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`alert alert-${t.type === 'error' ? 'danger' : 'success'} shadow-sm d-flex align-items-start`}>
            <i className={`fas ${t.type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'} me-2 mt-1`} />
            <div className="flex-grow-1">{t.message}</div>
            <button type="button" className="btn-close ms-2" aria-label="Close" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
