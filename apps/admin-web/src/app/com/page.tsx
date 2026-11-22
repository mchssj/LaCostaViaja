'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import ComConsole from '@/components/ComConsole';

export default function ComPage() {
  const router = useRouter();
  useEffect(() => {
    if (!localStorage.getItem('lc_token')) router.push('/login');
  }, [router]);
  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Consola COM — Alertas de pánico</h1>
      <ComConsole />
    </Shell>
  );
}