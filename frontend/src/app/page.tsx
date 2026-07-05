'use client';

import dynamic from 'next/dynamic';
import { Splash } from '@/components/layout/Splash';

/**
 * The terminal is a browser-only application (TradingView Lightweight Charts,
 * canvas overlays, Web Workers, IndexedDB/localStorage). We load it with
 * `ssr: false` so it is never server-rendered — eliminating any possibility of
 * a server/client HTML mismatch. The server and initial client render both show
 * the deterministic <Splash/>.
 */
const Terminal = dynamic(
  () => import('@/components/Terminal').then((m) => m.Terminal),
  { ssr: false, loading: () => <Splash /> },
);

export default function Page() {
  return <Terminal />;
}
