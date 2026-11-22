// Piezas comunes para las tablas del panel: etiquetas de estado, vencimientos, celdas de dos líneas
// y fila vacía. El estilo base de la tabla es la clase .tbl de globals.css.

import { fecha, vencimiento } from '@/lib/format';
import { texto, tono, type Grupo, type Tono } from '@/lib/labels';

const TONO_CLASE: Record<Tono, string> = {
  ok: 'bg-[#E3F4E8] text-[#1B6B35] border-[#A9D8B6]',
  aviso: 'bg-[#FFF4DB] text-[#7A5300] border-[#F1D28A]',
  error: 'bg-[#FDECEA] text-[#A31F1F] border-[#F2B8B5]',
  info: 'bg-[#E6F0FA] text-[#1D4F86] border-[#B5CFEA]',
  neutro: 'bg-[#EEF2F3] text-[#4F5F67] border-[#D3DCDF]',
};

export function Badge({ children, t = 'neutro', title }: { children: React.ReactNode; t?: Tono; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${TONO_CLASE[t]}`}>
      {children}
    </span>
  );
}

/** Etiqueta traducida y coloreada para un código de la API. */
export function CodeBadge({ grupo, code }: { grupo: Grupo; code: string | null | undefined }) {
  return <Badge t={tono(grupo, code)}>{texto(grupo, code)}</Badge>;
}

/** Fecha de vencimiento: rojo si venció, ámbar si vence en 30 días o menos. */
export function Vence({ value }: { value: string | null | undefined }) {
  const v = vencimiento(value);
  const cls = v === 'vencido' ? 'text-[#A31F1F] font-bold' : v === 'por-vencer' ? 'text-[#7A5300] font-bold' : '';
  const title = v === 'vencido' ? 'Vencido' : v === 'por-vencer' ? 'Vence en 30 días o menos' : undefined;
  return (
    <span className={`tabular-nums ${cls}`} title={title}>
      {fecha(value)}
      {v === 'vencido' && ' · vencido'}
    </span>
  );
}

/** Celda con un dato principal y uno secundario debajo, en gris. */
export function Two({ main, sub }: { main: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="leading-tight">
      <div className="font-semibold text-[#0A3A3C]">{main}</div>
      {sub !== undefined && sub !== null && sub !== '' && <div className="mt-0.5 text-[12px] text-[#5B6B72]">{sub}</div>}
    </div>
  );
}

export function EmptyRow({ cols, children = 'No hay registros.' }: { cols: number; children?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="!py-6 text-center text-[#5B6B72]">{children}</td>
    </tr>
  );
}

/** Título de tarjeta con contador y una ayuda opcional. */
export function CardTitle({ title, count, hint }: { title: string; count?: number; hint?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-[16px] font-bold text-[#0A3A3C]">
        {title}
        {count !== undefined && <span className="ml-2 rounded-full bg-[#E6F4F5] px-2 py-0.5 text-[12px] font-bold text-[#0F6B72]">{count}</span>}
      </h3>
      {hint && <div className="text-[12px] text-[#5B6B72]">{hint}</div>}
    </div>
  );
}
