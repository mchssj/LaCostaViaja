'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: '1. Monitoreo y COM' },
  { href: '/flota', label: '2. Flota y Habilitaciones' },
  { href: '/tarifas', label: '3. Cuadro Tarifario' },
  { href: '/estadisticas', label: '4. Estadísticas y Turismo' },
  { href: '/vouchers', label: '5. Vouchers y Beneficios' },
  { href: '/com', label: 'Consola COM' },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app flex h-screen w-full overflow-hidden bg-[#F4F8F8]">
      <nav className="sb flex w-[250px] flex-none flex-col gap-1.5 border-r-2 border-[#C9D3D8] bg-white px-3.5 py-5 box-border">
        <div className="mb-2.5 flex items-center gap-2.5 border-b-2 border-[#C9D3D8] pb-4.5">
          <div className="flex h-13 w-13 items-center justify-center rounded-full bg-[#0F6B72] font-bold text-white">LC</div>
          <div className="leading-tight">
            <b className="text-[15px] text-[#0A3A3C]">LaCostaViaja</b>
            <span className="block text-[13px] font-semibold text-[#34454D]">Gestión Municipal</span>
          </div>
        </div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`nv ${pathname === n.href ? 'on' : ''}`}>
            {n.label}
          </Link>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 border-t-2 border-[#C9D3D8] pt-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0F6B72] font-bold text-white">DT</div>
          <div className="leading-tight">
            <b className="text-[14px] text-[#0A3A3C]">Dirección de Transporte</b>
            <span className="block text-[13px] text-[#34454D]">Partido de La Costa</span>
          </div>
        </div>
      </nav>
      <div className="main flex flex-1 flex-col min-w-0">
        <header className="top flex h-16 flex-none items-center justify-between border-b-2 border-[#C9D3D8] bg-white px-6">
          <label className="flex items-center gap-2.5 text-[14px] font-semibold text-[#34454D]">
            Zona
            <select className="h-[42px] min-w-[340px] rounded-[10px] border-2 border-[#4F5F67] bg-white px-2.5 font-semibold text-[15px] text-[#0A3A3C]">
              <option>Todo el Partido (14 localidades)</option>
              <option>Zona Sur: Mar de Ajó - San Bernardo</option>
              <option>Zona Centro: Santa Teresita - Mar del Tuyú</option>
              <option>Zona Norte: San Clemente</option>
            </select>
          </label>
          <span className="pl t flex h-9 items-center gap-2 text-[14px]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0F6B72]" />
            Modo activo: Temporada Baja
          </span>
        </header>
        <main className="ct flex flex-1 flex-col gap-4 overflow-auto p-5">{children}</main>
      </div>
    </div>
  );
}