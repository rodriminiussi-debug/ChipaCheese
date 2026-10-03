# Deuda funcional (criterios de aceptación pendientes)

Criterios de las historias de Linear que no quedaron cubiertos en el sprint del módulo. Se resuelven en el
**Sprint de hardening** (tras integrar M5–M8). Actualizar este archivo al cerrar cada ítem.

| Historia        | Criterio pendiente                          | Notas                                                                                          |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| RF-20 (ROD-245) | Registro de planta sin señal (cola offline) | Usar `useOfflineAction` en consumos, pesadas y envasado; requiere idempotencia por `client_id` |
| RF-15 (ROD-251) | Inventario retomable sin señal              | Guardado parcial ya existe; falta cola offline                                                 |
| RF-02 (ROD-261) | Pedido cargado sin señal queda en cola      | `useOfflineAction` en `/pedidos/nuevo` + `client_id` en orders                                 |
