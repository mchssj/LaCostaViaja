import Shell from '@/components/Shell';

export default function ComPage() {
  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Consola COM</h1>
      <div className="card">
        <p className="text-[14px] text-[#34454D]">
          Atención de alertas de pánico en tiempo real (suscripción WebSocket + pg_notify de respaldo). (Fase 5 — en construcción)
        </p>
      </div>
    </Shell>
  );
}