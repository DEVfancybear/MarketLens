'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHistory } from '@/services/marketData';
import { useChartStore } from '@/store/chartStore';
import { useReplayStore } from '@/store/replayStore';

const BAR_LIMIT = 2000;

/**
 * Loads candles for the active symbol+timeframe into the chart store.
 * Disarms replay on any symbol/timeframe change to avoid stale cursors.
 */
export function useMarketData() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const setCandles = useChartStore((s) => s.setCandles);
  const setLoading = useChartStore((s) => s.setLoading);
  const disarm = useReplayStore((s) => s.disarm);
  const setTotal = useReplayStore((s) => s.setTotal);

  const query = useQuery({
    queryKey: ['history', symbol, timeframe],
    queryFn: () => fetchHistory({ ticker: symbol, timeframe, limit: BAR_LIMIT }),
  });

  useEffect(() => {
    setLoading(query.isFetching);
  }, [query.isFetching, setLoading]);

  useEffect(() => {
    if (query.data) {
      setCandles(query.data);
      setTotal(query.data.length);
      disarm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return query;
}
