'use client';

import { Component, type ReactNode } from 'react';

/**
 * Si el mapa falla (Leaflet no tolera que React reutilice su contenedor tras un Fast Refresh en
 * desarrollo), se vuelve a montar con una instancia nueva en vez de romper toda la pantalla.
 */
export default class MapBoundary extends Component<{ children: (attempt: number) => ReactNode }, { attempt: number; failed: boolean }> {
  override state = { attempt: 0, failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    // Reintenta en el próximo ciclo con otra clave; tras 3 intentos muestra un aviso.
    if (this.state.attempt < 3) setTimeout(() => this.setState((s) => ({ attempt: s.attempt + 1, failed: false })), 0);
  }

  override render() {
    if (this.state.failed) {
      return this.state.attempt >= 3 ? (
        <div className="flex h-full w-full items-center justify-center bg-[#E3EAEC] p-4 text-center text-[14px] text-[#5B6B72]">No se pudo mostrar el mapa. Recargá la página.</div>
      ) : (
        <div className="h-full w-full bg-[#E3EAEC]" />
      );
    }
    return this.props.children(this.state.attempt);
  }
}
