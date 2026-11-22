'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import ComAlerts from '@/components/ComAlerts';

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
          <svg width="100%" height="100%" viewBox="0 0 766 684" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Mapa del corredor Ruta 11" className="block">
            <rect width="766" height="684" fill="#EEF2EC" />
            <path d="M0 0H170C150 140 190 300 160 460C140 560 180 640 170 684H0Z" fill="#BFE3EC" />
            <path d="M170 0C150 140 190 300 160 460C140 560 180 640 170 684L196 684C206 640 166 560 186 460C216 300 176 140 196 0Z" fill="#F2E6C4" />
            <g fill="none" stroke="#D3DCD6" strokeWidth="12">
              <path d="M200 110 H760" /><path d="M200 250 H760" /><path d="M200 400 H760" /><path d="M200 560 H760" /><path d="M200 650 H760" />
            </g>
            <g fill="none" stroke="#fff" strokeWidth="8">
              <path d="M200 110 H760" /><path d="M200 250 H760" /><path d="M200 400 H760" /><path d="M200 560 H760" /><path d="M200 650 H760" />
            </g>
            <path d="M440 0C430 170 450 340 430 520C420 600 440 650 436 684" fill="none" stroke="#B9C7C2" strokeWidth="22" />
            <path d="M440 0C430 170 450 340 430 520C420 600 440 650 436 684" fill="none" stroke="#fff" strokeWidth="16" />
            <circle cx="300" cy="330" r="86" fill="#E08A00" fillOpacity=".28" />
            <circle cx="300" cy="610" r="96" fill="#E08A00" fillOpacity=".34" />
            <g fill="#0F6B72" stroke="#fff" strokeWidth="2.5">
              {[{x:297,y:184},{x:316,y:79},{x:233,y:578},{x:239,y:404},{x:364,y:89},{x:344,y:249},{x:224,y:118},{x:326,y:458},{x:232,y:276},{x:238,y:594},{x:323,y:90},{x:359,y:156},{x:272,y:626},{x:230,y:620},{x:364,y:436},{x:227,y:256},{x:226,y:600},{x:249,y:326},{x:322,y:177},{x:353,y:150},{x:361,y:345},{x:358,y:215},{x:241,y:625}].map((p,i)=>(<circle key={i} cx={p.x} cy={p.y} r="6" />))}
            </g>
            <g fontFamily="Inter,sans-serif" fontSize="14" fontWeight="700" fill="#0A3A3C" stroke="#fff" strokeWidth="4" paintOrder="stroke">
              <text x="455" y="56">San Clemente</text>
              <text x="455" y="190">Mar del Tuyú</text>
              <text x="455" y="334">Santa Teresita</text>
              <text x="455" y="500">Mar de Ajó</text>
              <text x="455" y="600">San Bernardo</text>
              <text x="455" y="634" fontSize="12" fill="#34454D" fontWeight="600">Ruta Provincial 11</text>
            </g>
            <circle cx="318" cy="628" r="12" fill="#B3261E" className="animate-pulse" />
            <circle cx="318" cy="628" r="11" fill="#B3261E" stroke="#fff" strokeWidth="3.5" />
            <rect x="160" y="566" width="180" height="30" rx="15" fill="#B3261E" />
            <text x="250" y="586" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13" fontWeight="700" fill="#fff">Alerta COM</text>
          </svg>
          <div className="absolute bottom-3.5 left-3.5 flex gap-3.5 rounded-[10px] border-2 border-[#C9D3D8] bg-white px-3 py-2 text-[13px] font-semibold text-[#0A3A3C]">
            <span>● Unidad activa</span>
            <span className="text-[#7A5200]">● Alta demanda</span>
            <span className="text-[#A31F1F]">● Alerta</span>
          </div>
        </div>
        <ComAlerts />
      </div>
    </Shell>
  );
}