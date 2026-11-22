import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LaCostaViaja — Modo Invitado',
  description: 'Pedí tu taxi o remis sin registrarte. Seguimiento en vivo.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0F6B72',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-[#F4F8F8] text-[#34454D] font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}