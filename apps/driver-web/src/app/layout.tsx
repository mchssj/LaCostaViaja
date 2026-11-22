import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'LaCostaViaja — Chofer', description: 'App del chofer (web)' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body className="bg-[#F4F8F8] text-[#34454D] font-sans antialiased">{children}</body></html>;
}