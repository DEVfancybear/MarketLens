import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SMC Trading Terminal',
  description:
    'Professional TradingView-style terminal with Replay Mode, Smart Money Concepts, backtesting and analytics.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050810',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="theme-dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=JSON.parse(localStorage.getItem('ui')||'null');var t=v&&v.theme==='light'?'light':'dark';var r=document.documentElement;r.classList.remove('theme-dark','theme-light');r.classList.add('theme-'+t);r.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
