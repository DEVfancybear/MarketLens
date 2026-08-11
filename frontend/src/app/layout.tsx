import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'MarketLens',
  description:
    'MarketLens is an institutional charting and risk-aware MT5 execution workspace with replay, Smart Money Concepts, journaling, alerts, and analytics.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070a12' },
    { media: '(prefers-color-scheme: light)', color: '#eef2f8' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A nonce is unique per request, so the root must not be statically cached.
  await connection();
  return (
    <html lang="en" className="theme-dark" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
