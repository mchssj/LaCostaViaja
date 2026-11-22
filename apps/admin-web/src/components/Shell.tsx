'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Monitoreo y COM', permission: 'monitor.view' },
  { href: '/com', label: 'Consola COM', permission: 'com.alerts.view' },
  { href: '/flota', label: 'Flota', permission: 'fleet.view' },
  { href: '/habilitaciones', label: 'Habilitaciones', permission: 'fleet.view' },
  { href: '/tarifas', label: 'Cuadro Tarifario', permission: 'tariffs.view' },
  { href: '/vouchers', label: 'Vouchers y Beneficios', permission: 'vouchers.view' },
  { href: '/estadisticas', label: 'Estadísticas y Turismo', permission: 'monitor.view' },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/usuarios', label: 'Usuarios', permission: 'users.manage' },
  { href: '/roles', label: 'Roles y permisos' },
  { href: '/configuracion', label: 'Configuración', permission: 'settings.view' },
  { href: '/auditoria', label: 'Auditoría', permission: 'audit.view' },
];

/**
 * Marco del panel. El menú muestra solo lo que el rol puede ver; `requires` bloquea la página si
 * se entra por URL. (La API vuelve a verificar cada pedido.)
 */
export default function Shell({ children, requires }: { children: React.ReactNode; requires?: string }) {
  const pathname = usePathname();
  const { user, loading, can, logout } = useSession();
  const visible = (items: NavItem[]) => items.filter((n) => !n.permission || can(n.permission));
  const admin = visible(ADMIN_NAV);
  const initials = (user?.fullName ?? user?.username ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app flex h-screen w-full overflow-hidden bg-[#F4F8F8]">
      <nav className="sb flex w-[250px] flex-none flex-col gap-1 overflow-y-auto border-r-2 border-[#C9D3D8] bg-white px-3.5 py-5 box-border">
        <div className="mb-2.5 flex items-center gap-3 border-b-2 border-[#C9D3D8] pb-4">
          {/* Logo institucional del Partido de La Costa (archivo provisto en mockup/assets). */}
          <img src="/logo-la-costa.png" alt="Municipio de La Costa" className="h-12 w-auto flex-none" />
          <div className="leading-tight">
            <b className="text-[15px] text-[#0A3A3C]">La Costa Viaja</b>
            <span className="block text-[13px] font-semibold text-[#34454D]">Gestión Municipal</span>
          </div>
        </div>
        {visible(NAV).map((n) => (
          <Link key={n.href} href={n.href} className={`nv ${pathname === n.href ? 'on' : ''}`}>
            {n.label}
          </Link>
        ))}
        {admin.length > 0 && (
          <>
            <div className="mt-3 px-3 text-[11px] font-bold uppercase tracking-wide text-[#7A8A91]">Administración</div>
            {admin.map((n) => (
              <Link key={n.href} href={n.href} className={`nv ${pathname === n.href ? 'on' : ''}`}>
                {n.label}
              </Link>
            ))}
          </>
        )}
        <div className="flex-1" />
        <div className="flex flex-col gap-2 border-t-2 border-[#C9D3D8] pt-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#0F6B72] text-[14px] font-bold text-white">{initials}</div>
            <div className="min-w-0 leading-tight">
              <b className="block truncate text-[14px] text-[#0A3A3C]">{user?.fullName ?? user?.username ?? '…'}</b>
              <span className="block truncate text-[12px] text-[#34454D]">
                {user?.roleName ?? ''}
                {user?.agencyName ? ` · ${user.agencyName}` : ''}
              </span>
            </div>
          </div>
          <div className="flex gap-2 text-[13px] font-bold">
            <Link href="/cuenta" className={`flex-1 rounded-[8px] px-2 py-1.5 text-center ${pathname === '/cuenta' ? 'bg-[#E6F4F5] text-[#0F6B72]' : 'text-[#0F6B72]'}`}>
              Mi cuenta
            </Link>
            <button onClick={logout} className="flex-1 rounded-[8px] px-2 py-1.5 text-[#A31F1F]">
              Salir
            </button>
          </div>
        </div>
      </nav>
      <div className="main flex min-w-0 flex-1 flex-col">
        <header className="top flex h-16 flex-none items-center justify-between border-b-2 border-[#C9D3D8] bg-white px-6">
          <label className="flex items-center gap-2.5 text-[14px] font-semibold text-[#34454D]">
            Zona
            <select className="h-[42px] min-w-[340px] rounded-[10px] border-2 border-[#4F5F67] bg-white px-2.5 text-[15px] font-semibold text-[#0A3A3C]">
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
        <main className="ct flex flex-1 flex-col gap-4 overflow-auto p-5">
          {loading || !user ? (
            <div className="text-[14px] text-[#5B6B72]">Cargando…</div>
          ) : requires && !can(requires) ? (
            <div className="card max-w-[560px]">
              <h1 className="text-[18px] font-bold text-[#0A3A3C]">No tenés acceso a esta sección</h1>
              <p className="mt-1 text-[14px]">Tu rol ({user.roleName}) no incluye este permiso. Si lo necesitás, pedíselo a un administrador.</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
