import type { Metadata } from 'next';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'La Costa Viaja · Gestión Municipal',
  description: 'Gestión municipal de transporte de pasajeros · Partido de La Costa',
  icons: { icon: '/logo-la-costa.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-[#F4F8F8] text-[#34454D] font-sans antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
