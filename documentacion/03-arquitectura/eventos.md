# Contrato de Eventos de Dominio

**Transporte**: interfaz `EventBus` → in-process + tabla `outbox` en el MVP (D-14).
**Regla no negociable** (Principio IV): el evento y el dato que lo origina se escriben en la **misma transacción**. Un consumidor que recibe dos veces el mismo evento produce **un** efecto.

## Sobre común

```jsonc
{
  "eventId": "uuid-v7",        // clave de idempotencia del consumidor
  "tipo": "ConteoRegistrado",
  "version": 1,                // aditiva; un campo nuevo no rompe consumidores
  "ocurridoEn": "2026-07-24T14:03:11.412Z",  // sello de servidor
  "actorId": "uuid",
  "payload": { }
}
```

## Eventos

| Evento | Lo emite | Lo consume | Payload |
|---|---|---|---|
| `ConteoRegistrado` | `captura` | `consolidacion` | `rondaId`, `articuloId`, `secuencia`, `estado`, `cantidad`, `unidadId`, `modoCaptura`, `origenParse` |
| `DiscrepanciaDetectada` | `consolidacion` | `auditoria` | `bodegaId`, `articuloId`, `motivo`, `rondasImplicadas[]` |
| `ProductoFantasmaRegistrado` | `captura` | `consolidacion`, `auditoria` | `rondaId`, `descripcion`, `unidadObservada`, `cantidad` |
| `RondaCerrada` | `captura` | `consolidacion` | `rondaId`, `bodegaId`, `operadorId`, `articulosResueltos` |
| `ArticuloConciliado` | `consolidacion` | `integracion` | `bodegaId`, `articuloId`, `valorFinal`, `rondasAfirmando`, `toleranciaAplicada` |
| `ReconteoRegistrado` | `auditoria` | `consolidacion` | `itemId`, `cantidad`, `codigoRazonId`, `auditorId` |
| `InventarioCerrado` | `auditoria` | `integracion` | `bodegaId`, `hashConsolidado`, `cerradoPor` |
| `InventarioExportado` | `integracion` | — | `bodegaId`, `formato`, `destino`, `referenciaEnvio` |

## Reglas

1. **Idempotencia obligatoria.** Cada consumidor registra `(consumidor, eventId)` antes de aplicar el efecto, en la misma transacción que el efecto.
2. **Sin lecturas cruzadas.** Un consumidor no consulta las tablas del dominio emisor: todo lo que necesita viaja en el payload o se pide por interfaz publicada (Principio III).
3. **Versionado aditivo.** Añadir un campo no incrementa `version`. Cambiar el significado de uno existente, sí — y exige que los consumidores soporten ambas versiones durante la transición.
4. **Orden no garantizado.** Los consumidores no asumen orden de llegada; reconstruyen estado desde el libro cuando el orden importa.
5. **Prohibido emitir fuera de la transacción** que persiste la causa. No hay excepciones documentadas.
