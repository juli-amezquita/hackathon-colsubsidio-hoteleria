import type { Server } from 'node:http';

import { Injectable, Inject, type OnApplicationShutdown } from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';

import { config } from '../../config';
import { PROVEEDOR_CATALOGO, type ProveedorDeCatalogo } from '../../platform/dominio/catalogo';
import { PROVEEDOR_RONDAS, type ProveedorDeRondas } from '../../platform/dominio/rondas';
import { SesionService } from '../../modules/identidad/sesion.service';
import { ResolucionService } from '../../modules/catalogo/resolucion.service';
import { avanzar, type Fase, type ItemEnCurso } from './dialogo';
import { SesionDeVoz } from './sesion-voz';

/**
 * El puente entre el operario y el sistema. `wss://…/voz/sesion?ronda=<id>`
 *
 * Une tres piezas que a propósito no se conocen entre sí:
 *
 *   navegador ──audio──▶ [ este puente ] ──audio──▶ Gemini (oye)
 *                              │
 *                              ├─▶ gramática + catálogo  ← AQUÍ se decide
 *                              │
 *   navegador ◀──audio── [ este puente ] ◀──audio── Gemini (habla)
 *
 * Lo único que hace el modelo es oír y pronunciar. Qué se entendió, si hace
 * falta preguntar y qué se registra lo decide `dialogo.ts`, que es una máquina
 * de estados sin una sola llamada a red (Restricción Técnica 1).
 *
 * ## Sobre la autenticación
 *
 * Un WebSocket no pasa por los guardas de Nest, así que la sesión se verifica
 * aquí, a mano, en el `upgrade`. Es la parte fácil de olvidar y por eso está
 * escrita antes que nada: si la cookie no vale, la conexión se destruye sin
 * llegar a existir.
 */
@Injectable()
export class PuenteDeVoz implements OnApplicationShutdown {
  private wss: WebSocketServer | null = null;

  constructor(
    // `@Inject` explícito y no solo el tipo: la metadata de tipos que emite
    // TypeScript se resuelve a `undefined` cuando los módulos se importan en
    // ciclo, y el síntoma —"can't resolve dependencies (?)"— no dice cuál ni
    // por qué. Con el token escrito, el ciclo deja de importar.
    @Inject(SesionService) private readonly sesiones: SesionService,
    @Inject(ResolucionService) private readonly resolucion: ResolucionService,
    @Inject(PROVEEDOR_CATALOGO) private readonly catalogo: ProveedorDeCatalogo,
    @Inject(PROVEEDOR_RONDAS) private readonly rondas: ProveedorDeRondas,
  ) {}

  montar(servidor: Server): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true });

    servidor.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://interno');
      if (url.pathname !== '/voz/sesion') return; // no es nuestro: que lo maneje otro

      const rechazar = (codigo: string): void => {
        socket.write(`HTTP/1.1 ${codigo}\r\n\r\n`);
        socket.destroy();
      };

      const usuario = this.sesiones.verificar(cookieDeSesion(req.headers.cookie, this.sesiones.nombreCookie));
      if (!usuario) return rechazar('401 Unauthorized');
      if (usuario.rol !== 'operador' && usuario.rol !== 'auditor') return rechazar('403 Forbidden');

      const rondaId = url.searchParams.get('ronda');
      if (!rondaId) return rechazar('400 Bad Request');

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        void this.atender(ws, rondaId, usuario.sub);
      });
    });
  }

  private async atender(ws: WebSocket, rondaId: string, usuarioId: string): Promise<void> {
    const clave = config().GEMINI_API_KEY;
    if (!clave) {
      enviar(ws, { tipo: 'error', mensaje: 'La voz no está configurada en este entorno.' });
      ws.close();
      return;
    }

    // Que la ronda sea SUYA se comprueba aquí y no se vuelve a preguntar: si
    // no lo es, `bodegaDeRondaPropia` lanza y la conexión no llega a abrirse.
    let bodegaId: string;
    try {
      bodegaId = await this.rondas.bodegaDeRondaPropia(rondaId, usuarioId);
    } catch {
      enviar(ws, { tipo: 'error', mensaje: 'Esa ronda no está abierta a tu nombre.' });
      ws.close();
      return;
    }

    // El catálogo, solo para el VOCABULARIO que se le pasa al transcriptor
    // (F-36). No se usa para resolver: eso lo hace `buscar`, contra la base.
    //
    // Si falla, la sesión abre igual y sin vocabulario: transcribir peor es un
    // problema; no poder contar, otro.
    const items = await this.catalogo.listar(bodegaId).catch(() => []);

    let fase: Fase = { tipo: 'esperando' };

    const gemini = new SesionDeVoz({
      claveApi: clave,
      terminos: items.map((a) => a.nombre),
      alRecibirAudio: (pcm) => {
        if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
      },
      alCerrar: (motivo) => {
        enviar(ws, { tipo: 'error', mensaje: `La voz se desconectó: ${motivo}` });
        if (ws.readyState === ws.OPEN) ws.close();
      },
      alTranscribir: (texto) => {
        enviar(ws, { tipo: 'escuche', texto });
        void turno(texto);
      },

    });

    /**
     * Un turno completo: se interpreta, se responde en voz y en texto, y si
     * quedó confirmado se le manda al dispositivo para que lo encole.
     */
    const turno = async (texto: string): Promise<void> => {
      const { fase: siguiente, accion } = await avanzar(fase, texto, (n) =>
        this.buscar(bodegaId, n),
      );
      fase = siguiente;
      if (accion.tipo === 'callar') return;

      // Se habla SIEMPRE, y además se manda el texto: la confirmación tiene que
      // ser visual y auditiva (Principio VIII). En una bodega con ruido, o con
      // un operario con protección auditiva puesta, el audio solo no llega.
      gemini.decir(accion.texto);
      enviar(ws, { tipo: 'dice', texto: accion.texto });

      if (accion.tipo === 'registrar') {
        // El puente NO escribe en la base. Manda el ítem confirmado al
        // dispositivo, que lo mete en su cola con clave de idempotencia — el
        // mismo camino que un conteo escrito a mano (F-18). Si aquí se guardara
        // directo, un conteo por voz y uno por texto tomarían caminos distintos
        // y solo uno sobreviviría a un corte de red.
        enviar(ws, { tipo: 'registrar', item: accion.item satisfies ItemEnCurso });
      }
    };

    gemini.abrir();

    // El saludo también se escribe, no solo se dice. Es la misma regla que
    // rige el resto del diálogo: visual Y auditivo, nunca una sola de las dos.
    const saludo = 'Listo para contar. Dime el producto y cuántos hay.';
    gemini.decir(saludo);
    enviar(ws, { tipo: 'dice', texto: saludo });

    ws.on('message', (datos: Buffer, esBinario: boolean) => {
      if (esBinario) {
        gemini.enviarAudio(datos);
        return;
      }
      // Los marcos de texto son control, no audio.
      try {
        const m = JSON.parse(datos.toString()) as { tipo?: string; texto?: string };
        // Paridad voz/texto (FR-1.6): lo escrito recorre exactamente el mismo
        // diálogo que lo dictado, confirmación hablada incluida.
        if (m.tipo === 'texto' && m.texto) void turno(m.texto);
      } catch {
        /* marco inválido: se ignora en vez de tumbar la sesión */
      }
    });

    ws.on('close', () => gemini.cerrar());
    ws.on('error', () => gemini.cerrar());
  }

  /**
   * Resuelve el nombre contra el catálogo. **Con el mismo resolvedor del resto
   * del sistema**, no con una copia.
   *
   * Es una ida a Postgres por cada dictado —`pg_trgm` tarda menos de 5 ms— y
   * podría hacerse en memoria con el catálogo ya cargado. No se hace: dos
   * implementaciones de "qué artículo es este" divergen, y el día que
   * divergieran el operario oiría confirmar un artículo y el servidor guardaría
   * otro. Esa clase de fallo no deja rastro en ningún log.
   */
  private async buscar(bodegaId: string, nombre: string): Promise<{
    articulo: { articuloId: string; nombre: string } | null;
    candidatos: readonly { articuloId: string; nombre: string }[];
    unidadEsperada: string | null;
  }> {
    const r = await this.resolucion.resolver(bodegaId, nombre);

    if (r.estado === 'resuelto' && r.articulo) {
      return {
        articulo: { articuloId: r.articulo.articuloId, nombre: r.articulo.nombre },
        candidatos: [],
        unidadEsperada: r.articulo.unidadEsperada.nombre,
      };
    }

    // Duda o nada. En los dos casos el sistema NO elige (FR-1.27), y dictando
    // eso importa más que en pantalla: ahí se ve el nombre escogido; aquí el
    // operario solo oiría lo que el sistema decidió por él.
    return {
      articulo: null,
      candidatos: r.candidatos.map((c) => ({
        articuloId: c.articulo.articuloId,
        nombre: c.articulo.nombre,
      })),
      unidadEsperada: r.candidatos[0]?.articulo.unidadEsperada.nombre ?? null,
    };
  }

  onApplicationShutdown(): void {
    this.wss?.close();
    this.wss = null;
  }
}

function enviar(ws: WebSocket, mensaje: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(mensaje));
}

/** La cookie de sesión, sacada a mano del encabezado: aquí no hay Fastify. */
function cookieDeSesion(encabezado: string | undefined, nombre: string): string | undefined {
  if (!encabezado) return undefined;
  for (const trozo of encabezado.split(';')) {
    const i = trozo.indexOf('=');
    if (i === -1) continue;
    if (trozo.slice(0, i).trim() === nombre) return decodeURIComponent(trozo.slice(i + 1).trim());
  }
  return undefined;
}
