import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'La Costa Viaja · Pedí tu taxi',
  description: 'Pedí un taxi o remis habilitado sin registrarte. Precio cerrado y seguimiento en vivo.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'La Costa Viaja', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#0F6B72',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
