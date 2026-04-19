import React from 'react';
import { motion } from 'framer-motion';
import { Map as MapIcon, Clock, Users, Waves, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'landscape', label: 'Landscape', icon: MapIcon },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'people', label: 'People', icon: Users },
  { id: 'patterns', label: 'Patterns', icon: Waves },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ current, onNavigate }) {
  return (
    <aside className="w-56 bg-white/30 border-r border-cream-dark flex flex-col">
      <div className="titlebar-drag h-14 flex items-end px-5 pb-2">
        <h1 className="font-display text-xl text-charcoal tracking-tight">Jurni</h1>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
              transition-all duration-150 relative
              ${current === id
                ? 'text-terracotta bg-white/60'
                : 'text-charcoal-light hover:text-charcoal hover:bg-white/40'}
            `}
          >
            {current === id && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 bg-white/60 rounded-xl"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Icon size={18} className="relative z-10" />
            <span className="relative z-10">{label}</span>
          </button>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-cream-dark">
        <p className="text-xs text-warm-gray">
          All data stored locally
        </p>
        <p className="text-xs text-warm-gray/60 mt-0.5">~/.jurni/</p>
      </div>
    </aside>
  );
}
