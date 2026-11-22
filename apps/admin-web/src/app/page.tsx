'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Shell from '@/components/Shell';
import ComAlerts from '@/components/ComAlerts';

const MapaCorredor = dynamic(() => import('@/components/MapaCorredor'), { ssr: false, loading: () => <div className="h-full w-full bg-[#EEF2EC]" /> });

export default function MonitoreoPage() {
  const router = useRouter();
  useEffect(() => {
    if (!localStorage.getItem('lc_token')) router.push('/login');
  }, [router]);

  return (
    <Shell>
      <div className="grid grid-cols-4 gap-4">
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Móviles habilitados online</div><div className="kp">184</div></div>
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Viajes activos ahora</div><div className="kp">62</div></div>
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Tiempo medio de espera</div><div className="kp">4 min</div></div>
        <div className="card border-[#B3261E] bg-[#FDECEA]"><div className="text-[13px] font-semibold text-[#34454D]">Alertas COM activas</div><div className="kp text-[#A31F1F]">—</div></div>
      </div>
      <div className="flex flex-1 gap-4 min-h-0">
        <div className="card flex-1 overflow-hidden p-0 relative">
          <MapaCorredor />
        </div>
        <ComAlerts />
      </div>
    </Shell>
  );
}