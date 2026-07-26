import type { Server } from 'node:http';

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';

import { PROVEEDOR_IDENTIDAD, type ProveedorDeIdentidad } from '../../platform/dominio/identidad';
import { SesionService } from '../identidad/sesion.service';
import { PresenciaService } from './presencia.service';
import { cookieDeSesion } from '../../platform/seguridad/cookie-ws';

/**
 * `wss://…/presencia` — la vista compartida del equipo.
 *
 * Cada dispositivo abre una conexión y recibe el estado de SUS bodegas cada vez
 * que alguien entra o sale de alguna. No hay sondeo: quien cuenta en una bodega
 * aparece en la pantalla de los demás en el momento, no dentro de treinta
 * segundos.
 *
 * ## Lo que viaja y lo que no
 *
 * Van nombres, cuántos hay y cuántas rondas lleva la bodega. **No va ni un solo
 * dato de conteo**: ni cantidades, ni artículos, ni avances. Un operario que
 * supiera que su compañero registró treinta panes ya no estaría contando a
 * ciegas, y la ceguera es la garantía sobre la que se apoya toda la
 * conciliación (D5, FR-1.18).
 *
 * Es la diferencia entre coordinar un equipo y filtrarle el resultado.
 */
@Injectable()
export class PresenciaGateway implements OnApplicationShutdown {
  private wss: WebSocketServer | null = null;
  private desuscribir: (() => void) | null = null;
  /** Quién está conectado y qué bodegas le interesan. */
  private readonly clientes = new Map<WebSocket, { usuarioId: string; bodegas: string[] }>();

  constructor(
    @Inject(SesionService) private readonly sesiones: SesionService,
    @Inject(PresenciaService) private readonly presencia: PresenciaService,
    @Inject(PROVEEDOR_IDENTIDAD) private readonly identidad: ProveedorDeIdentidad,
  ) {}

  montar(servidor: Server): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true });

    servidor.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://interno');
      if (url.pathname !== '/presencia') return;

      const usuario = this.sesiones.verificar(
        cookieDeSesion(req.headers.cookie, this.sesiones.nombreCookie),
      );
      if (!usuario) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        void this.atender(ws, usuario.sub);
      });
    });

    // Un solo suscriptor de Redis para todo el proceso, no uno por cliente.
    this.desuscribir = this.presencia.alCambiar(() => void this.difundir());
  }

  private async atender(ws: WebSocket, usuarioId: string): Promise<void> {
    // Solo las bodegas ASIGNADAS. Sin esto, cualquiera con sesión vería el
    // movimiento de bodegas que no le tocan — que no es un dato de inventario,
    // pero tampoco es asunto suyo.
    const bodegas = await this.identidad.bodegasDe(usuarioId).catch(() => []);
    this.clientes.set(ws, { usuarioId, bodegas: bodegas.map((b) => b.id) });

    await this.enviarA(ws);

    ws.on('message', (datos: Buffer) => {
      try {
        const m = JSON.parse(datos.toString()) as { tipo?: string; bodegaId?: string; nombre?: string };

        // El latido: mientras el dispositivo lo mande, su operario cuenta como
        // presente. Si el navegador se cierra de golpe —lo normal en un móvil—
        // la presencia caduca sola en Redis y nadie tiene que limpiarla.
        if (m.tipo === 'entrar' && m.bodegaId && m.nombre) {
          void this.presencia.entrar(m.bodegaId, usuarioId, m.nombre);
        }
        if (m.tipo === 'salir' && m.bodegaId) {
          void this.presencia.salir(m.bodegaId, usuarioId);
        }
      } catch {
        /* marco inválido: se ignora en vez de tumbar la conexión */
      }
    });

    ws.on('close', () => this.clientes.delete(ws));
    ws.on('error', () => this.clientes.delete(ws));
  }

  private async enviarA(ws: WebSocket): Promise<void> {
    const cliente = this.clientes.get(ws);
    if (!cliente || ws.readyState !== ws.OPEN) return;

    const bodegas = await this.presencia.estado(cliente.bodegas).catch(() => []);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ tipo: 'estado', bodegas }));
  }

  private async difundir(): Promise<void> {
    await Promise.all([...this.clientes.keys()].map((ws) => this.enviarA(ws)));
  }

  onApplicationShutdown(): void {
    this.desuscribir?.();
    this.desuscribir = null;
    this.wss?.close();
    this.wss = null;
    this.clientes.clear();
  }
}
