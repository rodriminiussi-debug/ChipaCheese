# Deuda funcional (criterios de aceptación pendientes)

Criterios de las historias de Linear que no quedaron cubiertos en el sprint del módulo. Se resuelven en el
**Sprint de hardening** (tras integrar M5–M8). Actualizar este archivo al cerrar cada ítem.

| Historia        | Criterio pendiente                                               | Notas                                                                                       |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| RF-20 (ROD-245) | ~~Cambio de estado de la producción (iniciar, congelado) sin señal~~ | RESUELTO: `production.runStatus` en la cola, idempotente por `clientId` (`production_status_changes`) |
| RF-25 (ROD-267) | ~~Entrega con conformidad (foto/firma) sin señal~~ | RESUELTO: el `File` de la foto/firma viaja en el payload encolado (IndexedDB guarda Blobs); idempotente por `dispatches.delivery_client_id` |
