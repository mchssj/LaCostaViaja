'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setTripId } from '@/lib/api';

interface Quote {
  quoteId: string;
  totalCents: number;
  totalFormatted: string;
  scope: string;
  lines: { code: string; label: string; amountCents: number }[];
  tariff: { season: string; timeBand: string; scheduleCode: string };
  validUntil: string;
}

export default function CotizarPage() {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const origin = JSON.parse(sessionStorage.getItem('lc_origin') ?? 'null');
    const destination = JSON.parse(sessionStorage.getItem('lc_destination') ?? 'null');
    if (!origin || !destination) { router.push('/'); return; }
    setLoading(true);
    apiFetch<Quote>('/fares/quote', {
      method: 'POST',
      body: JSON.stringify({ origin, destination, serviceType: 'TAXI' }),
    })
      .then(setQuote)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [router]);

  async function confirmar() {
    if (!quote) return;
    setConfirming(true);
    setError(null);
    try {
      const origin = JSON.parse(sessionStorage.getItem('lc_origin')!);
      const destination = JSON.parse(sessionStorage.getItem('lc_destination')!);
      const trip = await apiFetch<{ id: string }>('/trips', {
        method: 'POST',
        body: JSON.stringify({
          origin, destination, serviceType: 'TAXI', paymentMethod: 'CASH', channel: 'GUEST_QR_PWA',
        }),
      });
      setTripId(trip.id);
      router.push('/seguimiento');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center bg-[#F4F8F8]"><p>Cotizando…</p></main>;

  return (
    <main className="min-h-screen flex flex-col items-center p-6 bg-[#F4F8F8]">
      <div className="w-full max-w-md flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C]">Cotización</h1>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        {quote && (
          <div className="bg-white border-2 border-[#C9D3D8] rounded-[14px] p-4 flex flex-col gap-2">
            <div className="text-[24px] font-bold text-[#0A3A3C]">{quote.totalFormatted}</div>
            <div className="text-[13px] text-[#34454D]">Tarifa cerrada · {quote.scope} · {quote.tariff.season} / {quote.tariff.timeBand}</div>
            <div className="border-t border-[#E3EAEC] pt-2 flex flex-col gap-1">
              {quote.lines.map((l, i) => (
                <div key={i} className="flex justify-between text-[13px] text-[#0A3A3C]">
                  <span>{l.label ?? l.code}</span>
                  <span>${(l.amountCents / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="text-[12px] text-[#34454D]">Válida hasta {new Date(quote.validUntil).toLocaleTimeString()}</div>
          </div>
        )}
        <button onClick={confirmar} disabled={!quote || confirming}
          className="h-12 border-0 rounded-[10px] bg-[#0F6B72] text-white font-bold text-[16px] cursor-pointer disabled:opacity-60">
          {confirming ? 'Confirmando…' : 'Confirmar viaje'}
        </button>
        <button onClick={() => router.push('/')} className="h-11 border-2 border-[#0F6B72] rounded-[10px] bg-white text-[#0F6B72] font-bold text-[15px]">
          Volver
        </button>
      </div>
    </main>
  );
}