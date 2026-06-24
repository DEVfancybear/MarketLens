'use client';
import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Plus, X, ArrowUpDown, Search } from 'lucide-react';
import { fetchQuote, SYMBOLS, getSymbol } from '@/services/marketData';
import { useWatchlistStore, type SortKey } from '@/store/watchlistStore';
import { useChartStore } from '@/store/chartStore';
import { Dropdown } from '@/components/ui/Dropdown';
import { Panel } from '@/components/ui/Panel';
import { IconButton } from '@/components/ui/IconButton';
import { fmtPrice, fmtPct, fmtVolume } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { Quote } from '@/types';

export function Watchlist() {
  const { symbols, sortKey, sortDir, add, remove, setSort } = useWatchlistStore();
  const activeSymbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);

  const quoteQueries = useQueries({
    queries: symbols.map((ticker) => ({
      queryKey: ['quote', ticker],
      queryFn: () => fetchQuote(ticker),
      refetchInterval: 15_000,
    })),
  });

  const rows = useMemo(() => {
    const data = symbols.map((ticker, i) => ({
      ticker,
      quote: quoteQueries[i]?.data as Quote | undefined,
    }));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const qa = a.quote;
      const qb = b.quote;
      switch (sortKey) {
        case 'price': return ((qa?.last ?? 0) - (qb?.last ?? 0)) * dir;
        case 'change': return ((qa?.changePct ?? 0) - (qb?.changePct ?? 0)) * dir;
        case 'volume': return ((qa?.volume ?? 0) - (qb?.volume ?? 0)) * dir;
        default: return a.ticker.localeCompare(b.ticker) * dir;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, sortKey, sortDir, quoteQueries.map((q) => q.dataUpdatedAt).join(',')]);

  return (
    <Panel
      title="Watchlist"
      actions={
        <>
          <SortMenu sortKey={sortKey} onSort={setSort} />
          <AddSymbol onAdd={add} existing={symbols} />
        </>
      }
    >
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 px-3 py-1 text-[10px] uppercase tracking-wide text-ink-faint">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg%</span>
      </div>
      {rows.map(({ ticker, quote }) => {
        const prec = getSymbol(ticker)?.pricePrecision ?? 2;
        const up = (quote?.changePct ?? 0) >= 0;
        return (
          <div
            key={ticker}
            onClick={() => setSymbol(ticker)}
            className={cn(
              'group grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-x-2 px-3 py-1.5 hover:bg-terminal-hover',
              ticker === activeSymbol && 'bg-brand/10',
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-ink">{ticker}</div>
              <div className="truncate text-[10px] text-ink-faint">{fmtVolume(quote?.volume ?? 0)}</div>
            </div>
            <div className="tabular text-right text-xs text-ink">
              {quote ? fmtPrice(quote.last, prec) : '—'}
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className="tabular text-right text-xs" style={{ color: up ? 'var(--bull)' : 'var(--bear)' }}>
                {quote ? fmtPct(quote.changePct) : '—'}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); remove(ticker); }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Remove"
              >
                <X size={12} className="text-ink-faint hover:text-bear" />
              </button>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

function SortMenu({ sortKey, onSort }: { sortKey: SortKey; onSort: (k: SortKey) => void }) {
  const opts: { key: SortKey; label: string }[] = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'price', label: 'Last price' },
    { key: 'change', label: 'Change %' },
    { key: 'volume', label: 'Volume' },
  ];
  return (
    <Dropdown
      align="right"
      width={150}
      trigger={() => (
        <IconButton size="sm" label="Sort">
          <ArrowUpDown size={13} />
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          {opts.map((o) => (
            <button
              key={o.key}
              onClick={() => { onSort(o.key); close(); }}
              className={cn(
                'flex w-full px-3 py-1.5 text-left text-xs hover:bg-terminal-hover',
                o.key === sortKey ? 'text-brand' : 'text-ink',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

function AddSymbol({ onAdd, existing }: { onAdd: (t: string) => void; existing: string[] }) {
  const [q, setQ] = useState('');
  const avail = SYMBOLS.filter((s) => !existing.includes(s.ticker));
  const filtered = avail.filter(
    (s) => s.ticker.toLowerCase().includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Dropdown
      align="right"
      width={240}
      trigger={() => (
        <IconButton size="sm" label="Add symbol">
          <Plus size={14} />
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
            <Search size={12} className="text-ink-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Add symbol…"
              className="w-full bg-transparent text-xs text-ink outline-none"
            />
          </div>
          <div className="max-h-60 overflow-auto">
            {filtered.map((s) => (
              <button
                key={s.ticker}
                onClick={() => { onAdd(s.ticker); close(); }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-terminal-hover"
              >
                <span className="text-xs font-semibold text-ink">{s.ticker}</span>
                <span className="ml-2 truncate text-2xs text-ink-muted">{s.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-center text-2xs text-ink-faint">Nothing to add</div>
            )}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
