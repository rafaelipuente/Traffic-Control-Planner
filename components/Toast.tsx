"use client";

import { useEffect, useState } from "react";

export interface ToastProps {
  message: string;
  visible: boolean;
  onClose: () => void;
  duration?: number; // milliseconds, default 3000
  type?: "success" | "info";
}

/**
 * Simple toast notification that auto-dismisses after duration.
 */
export default function Toast({
  message,
  visible,
  onClose,
  duration = 3000,
  type = "success",
}: ToastProps) {
  const [isShowing, setIsShowing] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsShowing(true);
      const timer = setTimeout(() => {
        setIsShowing(false);
        // Small delay for exit animation before calling onClose
        setTimeout(onClose, 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration, onClose]);

  if (!visible && !isShowing) return null;

  const bgColor = type === "success" ? "bg-slate-900 border-[#FFB300]" : "bg-slate-800 border-blue-500";
  const icon = type === "success" ? (
    <div className="w-5 h-5 rounded-full bg-[#FFB300] flex items-center justify-center text-slate-900">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  ) : (
    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 transition-all duration-300 ease-out ${
        isShowing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
      role="alert"
      aria-live="polite"
    >
      <div className={`${bgColor} border-l-4 text-white px-4 py-3 rounded-sm shadow-xl flex items-center gap-3 max-w-md`}>
        {icon}
        <p className="text-sm font-medium">{message}</p>
        <button
          type="button"
          onClick={() => {
            setIsShowing(false);
            setTimeout(onClose, 300);
          }}
          className="ml-2 text-white/60 hover:text-white transition-colors"
          aria-label="Dismiss notification"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

