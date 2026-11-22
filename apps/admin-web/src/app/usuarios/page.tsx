'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, CardTitle, EmptyRow, Two } from '@/components/TableParts';
import { ConfirmAction, Field, Msg, OneTimeSecret, useAction } from '@/components/ui';
import { api } from '@/lib/api';
import { fechaHora } from '@/lib/format';
import { useSession } from '@/lib/session';

interface UserRow {
  id: string;
  username: string;
  full_name: string | null;
  email: string | null;
  role: string;
  role_name: string;
  agency_id: string | null;
  agency_name: string | null;
  is_active: boolean;
  locked: boolean;
  mfa_enabled: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
}
interface RoleInfo { role: string; name: string; description: string; mfaRequired: boolean }
interface Agency { id: string; trade_name: string }

const EMPTY = { username: '', fullName: '', email: '', role: 'COM_OPERATOR', agencyId: '' };

export default function UsuariosPage() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ fullName: '', email: '', role: '', agencyId: '' });
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const [filter, setFilter] = useState('');
  const { busy, msg, run } = useAction();

  const load = useCallback(async () => {
    const [u, r, a] = await Promise.all([api.get<UserRow[]>('/admin/users'), api.get<{ roles: RoleInfo[] }>('/admin/roles'), api.get<Agency[]>('/agencies')]);
    setUsers(u);
    setRoles(r.roles);
    setAgencies(a);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const roleInfo = (r: string) => roles.find((x) => x.role === r);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run('create', async () => {
      const res = await api.post<{ user: UserRow; temporaryPassword: string }>('/admin/users', {
        username: form.username.trim(),
        fullName: form.fullName.trim(),
        email: form.email.trim() || undefined,
        role: form.role,
        ...(form.role === 'AGENCY_OPERATOR' ? { agencyId: form.agencyId } : {}),
      });
      setSecret({
        title: `Contraseña temporal de ${res.user.username}`,
        value: res.temporaryPassword,
        note: 'Se muestra una sola vez. Entregala por un canal seguro: al primer ingreso el sistema pide cambiarla' + (roleInfo(form.role)?.mfaRequired ? ' y configurar el segundo factor.' : '.'),
      });
      setForm(EMPTY);
      await load();
    });
  };

  const act = (key: string, fn: () => Promise<unknown>, okText: string) =>
    run(key, async () => {
      await fn();
      await load();
      return okText;
    });

  const shown = users.filter((u) => !filter || `${u.username} ${u.full_name ?? ''} ${u.email ?? ''} ${u.role_name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Shell requires="users.manage">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Usuarios del panel</h1>
      {secret && <OneTimeSecret {...secret} onClose={() => setSecret(null)} />}
      <Msg msg={msg} />

      <form onSubmit={create} className="card grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <h2 className="text-[16px] font-bold text-[#0A3A3C] md:col-span-2 xl:col-span-5">Nuevo usuario</h2>
        <Field label="Usuario" hint="3 a 40 letras, números, punto o guion">
          <input className="in" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required pattern="[A-Za-z0-9._\-]{3,40}" />
        </Field>
        <Field label="Nombre y apellido">
          <input className="in" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required minLength={3} />
        </Field>
        <Field label="Correo (opcional)">
          <input className="in" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Rol" hint={roleInfo(form.role)?.description}>
          <select className="in" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roles.map((r) => <option key={r.role} value={r.role}>{r.name}</option>)}
          </select>
        </Field>
        {form.role === 'AGENCY_OPERATOR' ? (
          <Field label="Agencia">
            <select className="in" value={form.agencyId} onChange={(e) => setForm({ ...form, agencyId: e.target.value })} required>
              <option value="">Elegí…</option>
              {agencies.map((a) => <option key={a.id} value={a.id}>{a.trade_name}</option>)}
            </select>
          </Field>
        ) : <div />}
        <div className="md:col-span-2 xl:col-span-5">
          <button className="btn" disabled={busy === 'create'}>{busy === 'create' ? 'Creando…' : 'Crear usuario con contraseña temporal'}</button>
        </div>
      </form>

      <div className="card">
        <CardTitle title="Usuarios" count={users.length} hint={<input className="in h-9 w-[240px] text-[14px]" placeholder="Buscar…" value={filter} onChange={(e) => setFilter(e.target.value)} />} />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Segundo factor</th><th>Último ingreso</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <EmptyRow cols={6} />}
              {shown.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                  <td><Two main={<>{u.full_name ?? u.username}{u.id === me?.id && <span className="ml-1.5 text-[12px] text-[#0F6B72]">(vos)</span>}</>} sub={`${u.username}${u.email ? ` · ${u.email}` : ''}`} /></td>
                  <td><Two main={u.role_name} sub={u.agency_name ?? undefined} /></td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      {u.is_active ? <Badge t="ok">Activo</Badge> : <Badge t="neutro">Inactivo</Badge>}
                      {u.locked && <Badge t="error">Bloqueado</Badge>}
                      {u.must_change_password && <Badge t="aviso">Clave temporal</Badge>}
                    </div>
                  </td>
                  <td>{u.mfa_enabled ? <Badge t="ok">Activo</Badge> : roleInfo(u.role)?.mfaRequired ? <Badge t="aviso">Pendiente (obligatorio)</Badge> : <Badge t="neutro">No</Badge>}</td>
                  <td className="whitespace-nowrap tabular-nums">{fechaHora(u.last_login_at)}</td>
                  <td className="min-w-[260px]">
                    {editing === u.id ? (
                      <div className="flex flex-col gap-2">
                        <input className="in h-9 text-[14px]" placeholder="Nombre" value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />
                        <input className="in h-9 text-[14px]" placeholder="Correo" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                        <select className="in h-9 text-[14px]" value={edit.role} disabled={u.id === me?.id} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                          {roles.map((r) => <option key={r.role} value={r.role}>{r.name}</option>)}
                        </select>
                        {edit.role === 'AGENCY_OPERATOR' && (
                          <select className="in h-9 text-[14px]" value={edit.agencyId} onChange={(e) => setEdit({ ...edit, agencyId: e.target.value })}>
                            <option value="">Agencia…</option>
                            {agencies.map((a) => <option key={a.id} value={a.id}>{a.trade_name}</option>)}
                          </select>
                        )}
                        {edit.role !== u.role && <span className="text-[12px] text-[#7A5300]">Cambiar el rol cierra sus sesiones abiertas.</span>}
                        <div className="flex gap-2">
                          <button className="bo h-8 px-3 text-[12px]" onClick={() => setEditing(null)}>Cancelar</button>
                          <button
                            className="btn h-8 px-3 text-[12px]"
                            disabled={busy === `edit-${u.id}`}
                            onClick={() =>
                              act(`edit-${u.id}`, async () => {
                                await api.request('PATCH', `/admin/users/${u.id}`, {
                                  fullName: edit.fullName.trim() || undefined,
                                  email: edit.email.trim() || null,
                                  ...(u.id !== me?.id ? { role: edit.role } : {}),
                                  ...(edit.role === 'AGENCY_OPERATOR' ? { agencyId: edit.agencyId || null } : {}),
                                });
                                setEditing(null);
                              }, 'Usuario actualizado.')
                            }
                          >
                            Guardar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <button className="bo h-8 px-2.5 text-[12px]" onClick={() => { setEditing(u.id); setEdit({ fullName: u.full_name ?? '', email: u.email ?? '', role: u.role, agencyId: u.agency_id ?? '' }); }}>Editar</button>
                        {u.locked && <button className="bo h-8 px-2.5 text-[12px]" onClick={() => act(`unlock-${u.id}`, () => api.post(`/admin/users/${u.id}/unlock`), 'Cuenta desbloqueada.')}>Desbloquear</button>}
                        <ConfirmAction small label="Resetear clave" summary={<>Se genera una contraseña temporal para <b>{u.username}</b> y se cierran sus sesiones.</>} onConfirm={() =>
                          run(`reset-${u.id}`, async () => {
                            const res = await api.post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`);
                            setSecret({ title: `Nueva contraseña temporal de ${u.username}`, value: res.temporaryPassword, note: 'Se muestra una sola vez. Al ingresar se le pide cambiarla.' });
                            await load();
                          })
                        } />
                        {u.mfa_enabled && (
                          <ConfirmAction small label="Resetear 2FA" summary={<>Se borra el segundo factor de <b>{u.username}</b> (por ejemplo, si perdió el teléfono). Lo va a configurar de nuevo al ingresar.</>} onConfirm={() => act(`mfa-${u.id}`, () => api.post(`/admin/users/${u.id}/reset-mfa`), 'Segundo factor reseteado.')} />
                        )}
                        {u.id !== me?.id && (u.is_active ? (
                          <ConfirmAction small danger label="Desactivar" askReason="Motivo (queda en la auditoría)" summary={<>Desactivar a <b>{u.username}</b>: no podrá ingresar y se cierran sus sesiones al instante.</>} onConfirm={(reason) => act(`off-${u.id}`, () => api.post(`/admin/users/${u.id}/deactivate`, { reason }), 'Usuario desactivado.')} />
                        ) : (
                          <button className="bo h-8 px-2.5 text-[12px]" onClick={() => act(`on-${u.id}`, () => api.post(`/admin/users/${u.id}/activate`), 'Usuario reactivado.')}>Reactivar</button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
