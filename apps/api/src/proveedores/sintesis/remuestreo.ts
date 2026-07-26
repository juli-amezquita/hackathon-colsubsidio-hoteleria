/**
 * Remuestreo de PCM 16 bits mono por interpolación lineal.
 *
 * Existe por una restricción del proveedor: Polly no entrega PCM por encima de
 * 16 kHz, y el navegador espera 24 kHz (`HZ_SALIDA`). El ajuste se hace en el
 * servidor a propósito — el contrato de audio con el dispositivo no se toca.
 *
 * Interpolación lineal y no algo mejor porque esto es voz hablada de 16 kHz
 * estirada a 24 kHz: el factor es 1,5, no hay contenido nuevo que inventar y
 * el aliasing que introduce cae fuera de la banda de la voz. Un filtro
 * polifásico sonaría igual y costaría más CPU en una instancia pequeña por la
 * que ya pasa todo el audio de la bodega.
 */
export function remuestrear(pcm: Buffer, hzEntrada: number, hzSalida: number): Buffer {
  if (hzEntrada === hzSalida) return pcm;
  if (hzEntrada <= 0 || hzSalida <= 0) throw new Error('Frecuencias de remuestreo inválidas.');

  // Un byte suelto al final no es una muestra: se descarta en vez de leerlo a
  // medias y meter un chasquido.
  const muestras = pcm.length >> 1;
  if (muestras === 0) return Buffer.alloc(0);

  const paso = hzEntrada / hzSalida;
  // Multiplicar antes de dividir, no `muestras / paso`: con el paso ya
  // redondeado a binario, 16000 muestras daban 24000,000000000004 y el
  // resultado dependía de cómo cayera el `floor`.
  const total = Math.floor((muestras * hzSalida) / hzEntrada);
  const salida = Buffer.allocUnsafe(total * 2);

  for (let j = 0; j < total; j += 1) {
    const posicion = j * paso;
    const i = Math.floor(posicion);
    const fraccion = posicion - i;

    const actual = pcm.readInt16LE(i * 2);
    // La última muestra no tiene siguiente: se sostiene, que es silencio
    // continuado, en vez de leer fuera del búfer.
    const siguiente = i + 1 < muestras ? pcm.readInt16LE((i + 1) * 2) : actual;

    salida.writeInt16LE(Math.round(actual + (siguiente - actual) * fraccion), j * 2);
  }

  return salida;
}
