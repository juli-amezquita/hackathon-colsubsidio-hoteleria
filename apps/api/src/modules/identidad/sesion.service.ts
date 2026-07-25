import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { RolSchema, type Rol } from '@cci/contracts';

import { config } from '../../config';

/**
 * F-14 · Sesión firmada, SIN estado en el servidor.
 *
 * Es lo que hace que cualquier réplica atienda cualquier petición y que un
 * despliegue sea un reemplazo en vez de un *draining*. Con la sesión en memoria
 * del proceso, escalar exigiría sticky sessions y volveríamos a lo que D-07-A
 * nos permitió eliminar.
 *
 * La cookie es `httpOnly`: un token accesible desde JavaScript es robable por
 * XSS, y aquí no hay ninguna razón para que el cliente lo lea.
 */

const DURACION_MS = 12 * 60 * 60 * 1000; // una jornada de conteo con margen

export interface Contenido {
  readonly sub: string;
  readonly rol: Rol;
  readonly exp: number;
  readonly jti: string;
}

@Injectable()
export class SesionService {
  readonly nombreCookie = 'cci_sesion';

  emitir(usuarioId: string, rol: Rol): { valor: string; expiraEn: Date } {
    const exp = Date.now() + DURACION_MS;
    const contenido: Contenido = { sub: usuarioId, rol, exp, jti: randomUUID() };
    const cuerpo = Buffer.from(JSON.stringify(contenido)).toString('base64url');
    return { valor: `${cuerpo}.${this.firmar(cuerpo)}`, expiraEn: new Date(exp) };
  }

  /** Devuelve null ante cualquier problema. Nunca explica cuál: no hace falta. */
  verificar(cookie: string | undefined): Contenido | null {
    if (!cookie) return null;

    const corte = cookie.lastIndexOf('.');
    if (corte <= 0) return null;

    const cuerpo = cookie.slice(0, corte);
    const firma = cookie.slice(corte + 1);

    if (!this.firmaValida(cuerpo, firma)) return null;

    try {
      const crudo: unknown = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
      if (typeof crudo !== 'object' || crudo === null) return null;

      const o = crudo as Record<string, unknown>;
      if (typeof o['sub'] !== 'string' || typeof o['exp'] !== 'number') return null;
      if (o['exp'] < Date.now()) return null;

      return {
        sub: o['sub'],
        rol: RolSchema.parse(o['rol']),
        exp: o['exp'],
        jti: typeof o['jti'] === 'string' ? o['jti'] : '',
      };
    } catch {
      return null;
    }
  }

  opcionesCookie(expiraEn?: Date): Record<string, unknown> {
    return {
      httpOnly: true,
      // En producción la única entrada es HTTPS por CloudFront. En desarrollo se
      // relaja, o el navegador descartaría la cookie y no habría forma de probar.
      secure: config().NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/',
      ...(expiraEn ? { expires: expiraEn } : {}),
    };
  }

  private firmar(cuerpo: string): string {
    return createHmac('sha256', config().SESSION_SECRET).update(cuerpo).digest('base64url');
  }

  /**
   * Comparación en tiempo constante. Un `===` filtraría, por la diferencia de
   * tiempo en fallar, cuántos bytes de la firma acertó quien la está adivinando.
   */
  private firmaValida(cuerpo: string, firma: string): boolean {
    const esperada = Buffer.from(this.firmar(cuerpo));
    const recibida = Buffer.from(firma);
    if (esperada.length !== recibida.length) return false;
    return timingSafeEqual(esperada, recibida);
  }
}
