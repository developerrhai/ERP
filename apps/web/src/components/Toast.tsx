// App-wide toast (prototype .toast) announced through an aria-live region, so success
// messages after saves are visible and read out by screen readers.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ShowToast>((text) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), 3200);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={visible ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}
