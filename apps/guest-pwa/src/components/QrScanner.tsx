'use client';

import { useEffect, useRef } from 'react';

interface Props {
  onScan: (code: string) => void;
  onError?: (err: string) => void;
}

export default function QrScanner({ onScan, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled || !containerRef.current) return;
      const id = 'qr-reader';
      containerRef.current.id = id;
      const scanner = new Html5Qrcode(id);
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded: string) => {
            onScan(decoded);
            scanner.stop().catch(() => {});
          },
          () => {},
        );
      } catch (e: any) {
        onError?.(e?.message ?? 'No se pudo acceder a la cámara');
      }
    })();
    return () => {
      cancelled = true;
      scannerRef.current?.stop().catch(() => {});
      scannerRef.current?.clear().catch(() => {});
    };
  }, [onScan, onError]);

  return <div ref={containerRef} className="w-full max-w-sm mx-auto rounded-[14px] overflow-hidden border-2 border-[#C9D3D8]" />;
}