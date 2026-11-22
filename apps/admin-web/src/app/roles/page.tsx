'use client';

import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge } from '@/components/TableParts';
import { api } from '@/lib/api';

interface RolesResponse {
  permissions: Record<string, string>;
  roles: Array<{ role: string; name: string; description: string; permissions: string[]; mfaRequired: boolean }>;
}

/** Matriz de roles y permisos (solo lectura: los roles son fijos y se cambian en el código). */
export default function RolesPage() {
  const [data, setData] = useState<RolesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<RolesResponse>('/admin/roles').then(setData).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Roles y permisos</h1>
      <p className="max-w-[820px] text-[14px]">
        Cada usuario tiene un solo rol. Los permisos de cada rol son fijos: un cambio en esta matriz es un cambio revisado en el sistema, no una edición desde el panel.
        La API verifica cada permiso en cada pedido; el panel además oculta lo que el rol no puede usar.
      </p>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {data.roles.map((r) => (
              <div key={r.role} className="card flex flex-col gap-1.5">
                <div className="text-[15px] font-bold text-[#0A3A3C]">{r.name}</div>
                <div className="text-[13px]">{r.description}</div>
                {r.mfaRequired && <Badge t="aviso">Segundo factor obligatorio</Badge>}
              </div>
            ))}
          </div>
          <div className="card">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Permiso</th>
                    {data.roles.map((r) => <th key={r.role} className="text-center">{r.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.permissions).map(([key, label]) => (
                    <tr key={key}>
                      <td><div className="font-semibold">{label}</div><div className="font-mono text-[11px] text-[#7A8A91]">{key}</div></td>
                      {data.roles.map((r) => (
                        <td key={r.role} className="text-center text-[18px]">
                          {r.permissions.includes(key) ? <span className="text-[#1B6B35]" title="Permitido">✔</span> : <span className="text-[#C9D3D8]" title="No permitido">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-[#5B6B72]">El Operador de agencia ve y carga solo lo de su agencia; lo que carga queda pendiente hasta que Habilitaciones lo verifica.</p>
          </div>
        </>
      )}
    </Shell>
  );
}
