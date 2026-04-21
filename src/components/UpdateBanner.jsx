import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Auto-update toast. Subscribes to 'update-status' from the main process and
 * renders a minimal banner:
 *   · downloading → progress message (dismissable)
 *   · ready       → "Restart to install" call-to-action
 * Invisible in every other state (including dev, where the updater no-ops).
 */
export default function UpdateBanner({ api }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const off = api.onUpdateStatus?.((s) => {
      setStatus(s);
      if (s.state === 'ready' || s.state === 'downloading') setDismissed(false);
    });
    return () => off?.();
  }, [api]);

  const visible = !dismissed && status && (status.state === 'downloading' || status.state === 'ready');

  const handleInstall = async () => {
    try { await api.installUpdate?.(); } catch {}
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 1000,
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
            maxWidth: 360,
          }}
        >
          {status.state === 'downloading' && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>
                Downloading update
                {typeof status.percent === 'number' ? ` — ${status.percent}%` : '…'}
              </span>
              <button
                onClick={() => setDismissed(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                aria-label="Hide"
              >
                Hide
              </button>
            </>
          )}
          {status.state === 'ready' && (
            <>
              <span>
                Update ready{status.version ? ` — v${status.version}` : ''}.
              </span>
              <button
                onClick={handleInstall}
                style={{
                  background: 'var(--text-primary)',
                  color: 'var(--surface)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Restart to install
              </button>
              <button
                onClick={() => setDismissed(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                aria-label="Later"
              >
                Later
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
