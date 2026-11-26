import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ConfirmContext = createContext(() => Promise.resolve(false));

/** How a message should look, worked out from its first word: "Delete…" and "Remove…" are red warnings. */
function style(message, options) {
  const text = String(message || '').trim();
  const danger = /^(delete|remove|cancel)\b/i.test(text);
  const verb = text.match(/^(delete|remove|convert|cancel)\b/i)?.[1];
  return {
    tone: options.tone || (danger ? 'danger' : 'warning'),
    title: options.title || (danger ? 'Warning' : 'Please confirm'),
    confirmLabel: options.confirmLabel || (verb ? verb[0].toUpperCase() + verb.slice(1).toLowerCase() : 'OK'),
  };
}

/**
 * A small warning window in the middle of the screen, used instead of the browser's own message box.
 *   const confirm = useConfirm();
 *   if (!(await confirm('Delete this customer?'))) return;
 * Options: { title, confirmLabel, tone: 'danger' | 'warning' }.
 */
export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null);       // { message, tone, title, confirmLabel }
  const resolver = useRef(null);

  const confirm = useCallback((message, options = {}) => new Promise((resolve) => {
    resolver.current?.(false);                // a new question replaces any unanswered one
    resolver.current = resolve;
    setAsk({ message, ...style(message, options) });
  }), []);

  const answer = useCallback((value) => {
    resolver.current?.(value);
    resolver.current = null;
    setAsk(null);
  }, []);

  useEffect(() => {
    if (!ask) return undefined;
    const onKey = (e) => e.key === 'Escape' && answer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ask, answer]);

  const danger = ask?.tone === 'danger';
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <>
          <div className="modal d-block" style={{ zIndex: 1065 }} tabIndex="-1" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
            onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
            <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }}>
              <div className="modal-content border-0 shadow-lg">
                <div className="modal-body text-center p-4">
                  <div className={`d-inline-flex align-items-center justify-content-center rounded-circle mb-3 ${danger ? 'bg-danger-subtle text-danger' : 'bg-warning-subtle text-warning-emphasis'}`}
                    style={{ width: 56, height: 56, fontSize: '1.5rem' }}>
                    <i className="fas fa-triangle-exclamation" />
                  </div>
                  <h5 id="confirm-title" className="mb-2">{ask.title}</h5>
                  <p className="text-muted mb-4" style={{ whiteSpace: 'pre-line' }}>{ask.message}</p>
                  <div className="d-flex justify-content-center gap-2">
                    <button type="button" className="btn btn-light px-4" onClick={() => answer(false)} autoFocus={danger}>Cancel</button>
                    <button type="button" className={`btn px-4 ${danger ? 'btn-danger' : 'btn-success'}`} onClick={() => answer(true)} autoFocus={!danger}>{ask.confirmLabel}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show" style={{ zIndex: 1060 }} />
        </>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
