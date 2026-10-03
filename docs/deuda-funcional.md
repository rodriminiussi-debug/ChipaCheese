# Deuda funcional (criterios de aceptación pendientes)

Criterios de las historias de Linear que no quedaron cubiertos en el sprint del módulo. Se resuelven en el
**Sprint de hardening** (tras integrar M5–M8). Actualizar este archivo al cerrar cada ítem.

| Historia        | Criterio pendiente                                               | Notas                                                                                       |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| RF-20 (ROD-245) | Cambio de estado de la producción (iniciar, congelado) sin señal | Hoy solo consumos, pesadas y envasado se encolan; falta `setRunStatusAction` con `clientId` |
| RF-25 (ROD-267) | Entrega con conformidad (foto/firma) sin señal                   | La foto no entra en la cola de IndexedDB tal como está; evaluar guardar el Blob             |
