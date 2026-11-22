import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Almacenamiento de archivos (documentos de habilitación). En la base solo queda la clave y el hash. */
export interface IFileStorage {
  put(data: Buffer, extension: string): Promise<{ key: string; sha256: string }>;
  get(key: string): Promise<Buffer>;
}

/**
 * Disco local, FUERA del repositorio (por defecto ~/.lacosta-viaja/documents, o DOCUMENT_STORAGE_DIR).
 * Para producción se reemplaza por S3 / almacenamiento municipal con la misma interfaz (Fase 6).
 */
@Injectable()
export class LocalFileStorage implements IFileStorage {
  private readonly root = resolve(process.env['DOCUMENT_STORAGE_DIR'] || join(homedir(), '.lacosta-viaja', 'documents'));

  async put(data: Buffer, extension: string): Promise<{ key: string; sha256: string }> {
    const sha256 = createHash('sha256').update(data).digest('hex');
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extension}`;
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
    return { key, sha256 };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  /** La clave sale de la base, pero igual se impide salir de la carpeta raíz. */
  private pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Clave de archivo inválida');
    return path;
  }
}

/** Tipo de archivo por sus primeros bytes (no por la extensión ni el mime que manda el navegador). */
export function sniffFileType(buf: Buffer): { ext: 'pdf' | 'png' | 'jpg'; mime: string } | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}
