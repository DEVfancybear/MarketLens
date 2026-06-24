'use client';
import { Boxes } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useSmcStore, type SmcSettings } from '@/store/smcStore';
import { cn } from '@/utils/cn';

const ITEMS: { key: keyof SmcSettings; label: string; color: string }[] = [
  { key: 'structure', label: 'Market Structure (BOS/CHOCH/MSS)', color: 'var(--bos)' },
  { key: 'swings', label: 'Swing Points (HH/HL/LH/LL)', color: 'var(--text-muted)' },
  { key: 'fvg', label: 'Fair Value Gaps', color: 'var(--fvg)' },
  { key: 'orderBlocks', label: 'Order Blocks', color: 'var(--ob)' },
  { key: 'liquidity', label: 'Liquidity (EQH/EQL)', color: 'var(--liquidity)' },
  { key: 'displacement', label: 'Displacement', color: 'var(--choch)' },
  { key: 'sessions', label: 'Sessions', color: 'var(--bull)' },
  { key: 'killzones', label: 'Kill Zones', color: 'var(--choch)' },
];

export function SmcMenu() {
  const settings = useSmcStore((s) => s.settings);
  const toggle = useSmcStore((s) => s.toggle);

  return (
    <Dropdown
      width={280}
      trigger={(open) => (
        <button
          className={cn(
            'flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
            open ? 'bg-terminal-hover text-ink' : 'text-ink-muted hover:bg-terminal-hover hover:text-ink',
          )}
        >
          <Boxes size={14} />
          SMC
        </button>
      )}
    >
      {() => (
        <div className="py-0.5">
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Smart Money Concepts
          </div>
          {ITEMS.map((it) => (
            <button
              key={it.key}
              onClick={() => toggle(it.key)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-terminal-hover"
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 items-center justify-center rounded-sm border',
                  settings[it.key] ? 'border-transparent' : 'border-terminal-border',
                )}
                style={{ background: settings[it.key] ? it.color : 'transparent' }}
              >
                {settings[it.key] && <span className="text-[9px] text-white">✓</span>}
              </span>
              <span className="flex-1 text-ink">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
