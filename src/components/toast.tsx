"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastType = "success" | "error";

interface Toast {
  id: number;
  type: ToastType;
  text: string;
  leaving: boolean;
}

interface ToastApi {
  show: (type: ToastType, text: string) => void;
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// Time a toast stays before auto-dismissing, and the exit-transition length
// after which it's unmounted. Both animate via Tailwind and collapse to
// near-instant under prefers-reduced-motion (global override in globals.css).
const AUTO_DISMISS_MS = 4000;
const EXIT_MS = 200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    // Play the exit transition, then unmount once it's finished.
    setToasts((cur) => cur.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, EXIT_MS);
  }, []);

  const show = useCallback(
    (type: ToastType, text: string) => {
      const id = ++idRef.current;
      setToasts((cur) => [...cur, { id, type, text, leaving: false }]);
      setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (text) => show("success", text),
      error: (text) => show("error", text),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Fixed overlay so toasts never shift page layout. Bottom on mobile,
          bottom-right on larger screens. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur transition-all duration-200 ${
        toast.leaving ? "translate-y-2 opacity-0" : "animate-fade-in-up"
      } ${
        toast.type === "success"
          ? "border-green-700 bg-green-900/80 text-green-100"
          : "border-red-800 bg-red-900/80 text-red-100"
      }`}
    >
      <span aria-hidden="true" className="mt-0.5 leading-none">
        {toast.type === "success" ? "✓" : "⚠"}
      </span>
      <span className="flex-1">{toast.text}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-white/50 transition-colors hover:text-white leading-none"
      >
        ×
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
