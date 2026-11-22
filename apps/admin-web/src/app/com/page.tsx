'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import ComConsole from '@/components/ComConsole';

export default function ComPage() {
  const router = useRouter();
  useEffect(() => {
  }, [router]);
  return (
    <Shell requires="com.alerts.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Consola COM — Alertas de pánico</h1>
      <ComConsole />
    </Shell>
  );
}