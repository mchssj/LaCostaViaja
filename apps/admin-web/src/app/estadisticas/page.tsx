'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';

export default function EstadisticasPage() {
  const router = useRouter();
  useEffect(() => {
    if (!localStorage.getItem('lc_token')) router.push('/login');
  }, [router]);

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">4. Estadísticas y Turismo</h1>
      <div className="grid grid-cols-4 gap-4">
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Viajes hoy</div><div className="kp">124</div></div>
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Viajes esta semana</div><div className="kp">842</div></div>
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Ingreso estimado (¢)</div><div className="kp">4.2M</div></div>
        <div className="card"><div className="text-[13px] font-semibold text-[#34454D]">Choferes activos</div><div className="kp">184</div></div>
      </div>
      <div className="card flex-1 min-h-0">
        <h3 className="mb-2">Mapa de calor de demanda por localidad</h3>
        <p className="text-[14px] text-[#34454D]">
          (Fase 5 — visualización de demanda por localidad/zona. Datos mock hasta conectar métricas de producción.)
        </p>
      </div>
    </Shell>
  );
}