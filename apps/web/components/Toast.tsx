"use client";
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
}

interface ToastComponentProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const ToastComponent: React.FC<ToastComponentProps> = ({ toast, onClose }) => {
  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  const getColors = (type: ToastType) => {
    switch (type) {
      case 'success':
        return 'bg-green-900/90 border-green-500/30 text-green-100';
      case 'error':
        return 'bg-red-900/90 border-red-500/30 text-red-100';
      case 'warning':
        return 'bg-yellow-900/90 border-yellow-500/30 text-yellow-100';
      case 'info':
      default:
        return 'bg-blue-900/90 border-blue-500/30 text-blue-100';
    }
  };

  React.useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        onClose(toast.id);
      }, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -50, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`max-w-md w-full backdrop-blur-sm border rounded-lg p-4 shadow-lg ${getColors(toast.type)}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">{getIcon(toast.type)}</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm mb-1">{toast.title}</h4>
          {toast.message && (
            <p className="text-xs opacity-90 whitespace-pre-line">{toast.message}</p>
          )}
        </div>
        <button
          onClick={() => onClose(toast.id)}
          className="flex-shrink-0 text-white/60 hover:text-white/90 transition-colors"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastComponent key={toast.id} toast={toast} onClose={onClose} />
        ))}
      </AnimatePresence>
    </div>
  );
};

// Hook for managing toasts
export const useToast = () => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const addToast = React.useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    setToasts(prev => [...prev, { ...toast, id }]);
    return id;
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const showSuccess = React.useCallback((title: string, message?: string, duration?: number) => {
    return addToast({ title, message, type: 'success', duration });
  }, [addToast]);

  const showError = React.useCallback((title: string, message?: string, duration?: number) => {
    return addToast({ title, message, type: 'error', duration });
  }, [addToast]);

  const showInfo = React.useCallback((title: string, message?: string, duration?: number) => {
    return addToast({ title, message, type: 'info', duration });
  }, [addToast]);

  const showWarning = React.useCallback((title: string, message?: string, duration?: number) => {
    return addToast({ title, message, type: 'warning', duration });
  }, [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };
};