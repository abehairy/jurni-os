import React from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Pin, Sun, Moon } from 'lucide-react';
import logoUrl from '../assets/logo.png';

/**
 * Sidebar is the quiet shell around the landscape. It holds:
 *   1. A Jurni wordmark that acts as "home" — click returns to landscape
 *   2. A PINNED section (populated in Chunk B). Empty state doubles as
 *      onboarding: "Pin tiles to keep them close."
 *   3. Theme toggle (sun / moon) and a low-key settings gear at the bottom.
 *
 * All colors come from CSS variables so the same component works in both
 * light and dark themes. The palette flip is instantaneous and global.
 */
export default function Sidebar({ current, onNavigate, pins = [], onOpenPin, theme, onToggleTheme }) {
  const isSettings = current === 'settings';
  const hasPins = pins && pins.length > 0;

  return (
    <aside
      className="w-56 flex flex-col"
      style={{
        background: 'var(--shell)',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div className="titlebar-drag h-14 flex items-end px-5 pb-2">
        <button
          onClick={() => onNavigate('landscape')}
          className="font-display text-xl tracking-tight hover:opacity-70 transition-opacity cursor-pointer flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag', color: 'var(--text-primary)' }}
          title="Jurni — back to landscape"
        >
          <img
            src={logoUrl}
            alt=""
            width={22}
            height={22}
            style={{ display: 'block', flexShrink: 0 }}
          />
          <span>Jurni</span>
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <PinnedSection pins={pins} onOpenPin={onOpenPin} hasPins={hasPins} />
      </nav>

      <div className="px-3 pb-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onToggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
          style={{ color: 'var(--text-muted)', background: 'transparent' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.background = 'var(--hover-overlay)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.background = 'transparent';
          }}
          title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
        >
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
        </button>

        <button
          onClick={() => onNavigate('settings')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
          style={{
            color: isSettings ? 'var(--accent)' : 'var(--text-muted)',
            background: isSettings ? 'var(--accent-soft)' : 'transparent',
          }}
          onMouseEnter={(e) => {
            if (!isSettings) {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--hover-overlay)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSettings) {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <SettingsIcon size={15} />
          <span>Settings</span>
        </button>
        <div className="px-3 pt-2 pb-1">
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            All data stored locally
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)', opacity: 0.7 }}>
            ~/.jurni/
          </p>
        </div>
      </div>
    </aside>
  );
}

function PinnedSection({ pins, onOpenPin, hasPins }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 mb-2">
        <Pin size={10} style={{ color: 'var(--text-faint)' }} />
        <span
          className="text-[10px] uppercase tracking-widest font-medium"
          style={{ color: 'var(--text-faint)' }}
        >
          Pinned
        </span>
      </div>

      {!hasPins && (
        <div
          className="px-3 py-3 mx-1 rounded-lg"
          style={{ border: '1px dashed var(--border-strong)' }}
        >
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Pin tiles to keep them close.
          </p>
        </div>
      )}

      {hasPins && (
        <div className="space-y-0.5">
          {pins.map((pin, i) => (
            <motion.button
              key={pin.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => onOpenPin?.(pin)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors text-left group"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--hover-overlay)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: pin.colorHex || 'var(--accent)' }}
              />
              <span className="truncate flex-1">{pin.label}</span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
