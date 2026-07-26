/**
 * El agente de voz, del lado del dispositivo.
 *
 * Sustituye a la Web Speech API del navegador, que era la demostración. Tres
 * razones para sacarla y ninguna es preferencia:
 *
 *   1. **Solo entiende, no habla.** El Principio VIII y el Escenario 5 de la
 *      Historia 1 exigen que la confirmación sea "perceptible de forma visual
 *      **y** auditiva". Con Web Speech el operario dicta y el sistema calla.
 *   2. **No conoce el catálogo.** Un modelo general del español oye "aceite de
 *      ajonjolí" como puede; con los 300 nombres de la bodega delante, acierta.
 *      Ese vocabulario solo se puede pasar del lado del servidor.
 *   3. **No es un proveedor.** Es una función del navegador, distinta en cada
 *      uno y ausente en la mayoría fuera de Chrome. La Restricción 5 pide un
 *      proveedor con alternativa; esto no lo era.
 *
 * ## Cómo va el audio
 *
 *   micrófono → PCM 16 bits 16 kHz → nuestro WebSocket → (servidor) → Gemini
 *   Gemini → PCM 24 kHz → (servidor) → nuestro WebSocket → altavoz
 *
 * El navegador NO habla directo con Gemini: sus tokens efímeros se emiten pero
 * no autentican el WebSocket (probado), y la única alternativa sería mandarle
 * la clave de cuenta al navegador, que es publicarla.
 */

/** Lo que Gemini espera a la entrada. No es negociable. */
const HZ_ENTRADA = 16000
/** Y lo que devuelve. Tampoco. */
const HZ_SALIDA = 24000

export type Estado = 'apagado' | 'conectando' | 'escuchando' | 'hablando' | 'silenciado' | 'error'

export interface ItemConfirmado {
  articuloId: string | null
  nombre: string
  cantidad: number
  unidad: string | null
  dictado: string
}

export interface Manejadores {
  /** Hallazgo físico sin correspondencia en el catálogo (Historia 5). */
  alHallar: (item: ItemConfirmado) => void
  /** El operario sostiene su conteo pese a la alerta (FR-2.4). */
  alSostener: (registroId: string) => void
  /** Lo que el operario dijo, según el transcriptor. */
  alEscuchar: (texto: string) => void
  /** Lo que el sistema respondió. Se muestra ADEMÁS de decirse. */
  alResponder: (texto: string) => void
  /** Confirmado por el operario: hay que encolarlo. */
  alConfirmar: (item: ItemConfirmado) => void
  alCambiarEstado: (estado: Estado) => void
  /** Algo que el operario debe saber sin que el conteo se detenga. */
  alAvisar: (mensaje: string) => void
  alFallar: (mensaje: string) => void
}

export class AgenteDeVoz {
  private ws: WebSocket | null = null
  private ctxEntrada: AudioContext | null = null
  private ctxSalida: AudioContext | null = null
  private stream: MediaStream | null = null
  private nodo: ScriptProcessorNode | null = null
  /** Cuándo termina lo que ya está sonando, para encadenar sin cortes. */
  private finDeCola = 0
  private silenciado = false

  constructor(private readonly m: Manejadores) {}

  async conectar(rondaId: string): Promise<void> {
    this.m.alCambiarEstado('conectando')

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // En una bodega esto no es lujo: hay eco de nave, motores y radios.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
    } catch {
      this.m.alFallar('No se pudo abrir el micrófono. Revisa los permisos del navegador.')
      this.m.alCambiarEstado('error')
      return
    }

    // Mismo origen que la página: la cookie de sesión es SameSite=Strict y el
    // servidor autentica el WebSocket con ella.
    const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocolo}//${location.host}/voz/sesion?ronda=${rondaId}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.m.alCambiarEstado('escuchando')
      this.abrirMicrofono()
    }

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.reproducir(e.data)
        return
      }
      let m: Record<string, unknown>
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m['tipo'] === 'escuche') this.m.alEscuchar(String(m['texto'] ?? ''))
      if (m['tipo'] === 'dice') this.m.alResponder(String(m['texto'] ?? ''))
      if (m['tipo'] === 'registrar') this.m.alConfirmar(m['item'] as ItemConfirmado)
      if (m['tipo'] === 'hallazgo') this.m.alHallar(m['item'] as ItemConfirmado)
      if (m['tipo'] === 'sostener') this.m.alSostener(String(m['registroId'] ?? ''))
      if (m['tipo'] === 'aviso') this.m.alAvisar(String(m['mensaje'] ?? ''))
      if (m['tipo'] === 'error') {
        this.m.alFallar(String(m['mensaje'] ?? 'Falló la voz.'))
        this.m.alCambiarEstado('error')
      }
    }

    ws.onerror = () => {
      this.m.alFallar('Se perdió la conexión de voz.')
      this.m.alCambiarEstado('error')
    }
    ws.onclose = () => this.m.alCambiarEstado('apagado')
  }

  /**
   * Escribir por teclado recorre el MISMO diálogo que dictar (FR-1.6).
   *
   * Incluida la confirmación hablada: quien escribe también oye lo que quedó,
   * y quien dicta puede corregir escribiendo sin perder el turno en curso.
   */
  escribir(texto: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ tipo: 'texto', texto }))
    }
  }

  /**
   * Le cuenta al agente que llegó una alerta del servidor.
   *
   * La alerta es DIFERIDA: el conteo se confirmó, se encoló, y el veredicto
   * llegó cuando el operario ya iba en otro artículo. Sin este aviso la alerta
   * se quedaba muda y aparecía al final, como un bloqueo que impedía cerrar la
   * ronda y que nadie sabía de dónde salía.
   */
  avisarAlerta(a: { registroId: string; articuloId: string | null; nombre: string; cantidad: number }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ tipo: 'alerta', ...a }))
    }
  }

  /**
   * Corta o reanuda el envío del micrófono.
   *
   * Sirve para lo obvio —hablar con un compañero sin que el sistema lo oiga— y
   * para lo que ocurre de verdad en una bodega: el agente está a mitad de una
   * frase larga y el operario no quiere que su propia voz entre encima.
   */
  silenciar(valor: boolean): void {
    this.silenciado = valor
    this.m.alCambiarEstado(valor ? 'silenciado' : 'escuchando')
  }

  get estaSilenciado(): boolean {
    return this.silenciado
  }

  private abrirMicrofono(): void {
    if (!this.stream) return

    // `sampleRate` fijo a 16 kHz: el navegador remuestrea con su propio código
    // nativo, mejor que cualquier interpolación que escribamos aquí.
    const ctx = new AudioContext({ sampleRate: HZ_ENTRADA })
    this.ctxEntrada = ctx

    const fuente = ctx.createMediaStreamSource(this.stream)
    // `ScriptProcessor` está obsoleto y funciona en todos los navegadores que
    // le importan al cliente. `AudioWorklet` es el reemplazo correcto y exige
    // servir un archivo aparte; queda anotado como deuda, no como olvido.
    const nodo = ctx.createScriptProcessor(4096, 1, 1)
    this.nodo = nodo

    nodo.onaudioprocess = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return
      // Silenciado: se descarta el bloque ANTES de convertirlo y enviarlo.
      //
      // Se corta aquí y no cerrando el micrófono porque volver a abrirlo pide
      // permiso otra vez en algunos navegadores, y porque la sesión con el
      // proveedor tardaría en rehacerse. Cortar el envío es instantáneo y, al
      // no salir del dispositivo, es tan privado como apagarlo: lo que no se
      // manda no se transcribe ni se factura.
      if (this.silenciado) return
      const f32 = e.inputBuffer.getChannelData(0)
      const pcm = new Int16Array(f32.length)
      for (let i = 0; i < f32.length; i += 1) {
        const v = Math.max(-1, Math.min(1, f32[i]!))
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
      }
      this.ws.send(pcm.buffer)
    }

    fuente.connect(nodo)
    // Al destino con ganancia cero: `ScriptProcessor` no dispara si no está
    // conectado a algo, pero devolver el micrófono al altavoz sería un acople.
    const mudo = ctx.createGain()
    mudo.gain.value = 0
    nodo.connect(mudo)
    mudo.connect(ctx.destination)
  }

  /** Encola un trozo de audio del agente para que suene sin huecos. */
  private reproducir(datos: ArrayBuffer): void {
    this.ctxSalida ??= new AudioContext({ sampleRate: HZ_SALIDA })
    const ctx = this.ctxSalida
    void ctx.resume()

    const pcm = new Int16Array(datos)
    if (pcm.length === 0) return

    const buffer = ctx.createBuffer(1, pcm.length, HZ_SALIDA)
    const canal = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i += 1) canal[i] = pcm[i]! / 0x8000

    const fuente = ctx.createBufferSource()
    fuente.buffer = buffer
    fuente.connect(ctx.destination)

    // Los trozos llegan más rápido de lo que suenan. Encadenarlos al final de
    // la cola —y no en `currentTime`— es lo que evita que se pisen y suene
    // como una radio mal sintonizada.
    const ahora = ctx.currentTime
    const inicio = Math.max(ahora, this.finDeCola)
    fuente.start(inicio)
    this.finDeCola = inicio + buffer.duration

    this.m.alCambiarEstado('hablando')
    fuente.onended = () => {
      if (ctx.currentTime >= this.finDeCola - 0.05) {
        this.m.alCambiarEstado(this.silenciado ? 'silenciado' : 'escuchando')
      }
    }
  }

  desconectar(): void {
    this.nodo?.disconnect()
    this.nodo = null
    void this.ctxEntrada?.close()
    this.ctxEntrada = null
    void this.ctxSalida?.close()
    this.ctxSalida = null
    this.finDeCola = 0
    this.silenciado = false
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.ws?.close()
    this.ws = null
    this.m.alCambiarEstado('apagado')
  }
}
