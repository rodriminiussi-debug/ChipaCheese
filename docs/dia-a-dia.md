# Día a día de cada usuario

Lista de control funcional: cada tarea real de cada persona, en qué pantalla se hace y su estado.
✅ existe · ⚠️ parcial · ❌ falta. Se revisa en cada sprint; la revisión de lógica usa este documento.

## Dirección — Nahuel (PC y celular)

| Momento  | Tarea                                                                                                                     | Pantalla                                | Estado             |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------ |
| Mañana   | Ver qué hay que atender: pedidos atrasados, clientes para llamar, deuda vencida, cheques, insumos a reponer               | `/tablero`                              | ✅                 |
| Mañana   | Ver el negocio en gráficos: ventas, producción, márgenes, deuda, tendencia del mes                                        | `/tablero`                              | ⚠️ solo 2 gráficos |
| Día      | Cargar una factura de proveedor sacando una foto                                                                          | `/compras/facturas/nueva`               | ✅                 |
| Día      | Llamar a clientes que no piden; ver su historial y frecuencia                                                             | `/pedidos`, `/clientes/[id]`            | ✅                 |
| Día      | Revisar y ajustar precios por canal con su margen                                                                         | `/precios`                              | ✅                 |
| Eventual | **Dar de alta un producto nuevo** (chipá, reventa como gaseosas, elaborados del local) con su equivalente en chipá o masa | —                                       | ❌                 |
| Eventual | Dar de alta un insumo nuevo, una zona de reparto, un vehículo, un equipo, una lista de precios para un canal nuevo        | —                                       | ❌                 |
| Eventual | Dar de alta un usuario, resetear contraseña o PIN                                                                         | `/admin`                                | ✅                 |
| Eventual | Cambiar su propia contraseña                                                                                              | —                                       | ❌                 |
| Eventual | Cliente nuevo; proveedor nuevo                                                                                            | `/clientes/nuevo`, `/proveedores/nuevo` | ✅                 |
| Eventual | Cheque rechazado: reabrir la deuda                                                                                        | `/cobranzas/cheques`                    | ✅                 |
| Mes      | Cargar gastos fijos, ver el resultado y si cubre los retiros                                                              | `/costos/gastos`, `/costos/resultado`   | ✅                 |
| Mes      | Exportar compras y ventas para la contadora                                                                               | `/compras`, `/cobranzas`                | ✅                 |

## Jefa de producción — A.F. (tablet y celular)

| Momento  | Tarea                                                                              | Pantalla                                             | Estado                           |
| -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| Apertura | Revisar temperaturas de la noche y alertas de calidad                              | `/calidad`                                           | ✅                               |
| Apertura | Asignar tareas del día; cubrir ausencias con reemplazos sugeridos                  | `/personas`                                          | ✅                               |
| Apertura | Plan del día según pedidos, stock y capacidad                                      | `/produccion`                                        | ✅                               |
| Día      | Recibir pedidos por WhatsApp y cargarlos                                           | `/pedidos/nuevo`                                     | ✅                               |
| Día      | Hoja de envasado del día; marcar pedidos listos                                    | `/pedidos/envasado`, `/pedidos/[id]`                 | ✅                               |
| Día      | Ver cobertura de insumos; armar orden de compra; recibir mercadería                | `/stock`, `/compras/ordenes`, `/compras/recepciones` | ✅                               |
| Día      | Reponer el local cuando pide (transferencia F3/F4 → Local)                         | `/stock/producto-terminado`                          | ⚠️ sin pedido del local ni aviso |
| Día      | Registrar merma, recorte para pizzetas, donaciones                                 | `/stock/insumos/[id]` (ajuste)                       | ✅                               |
| Semana   | Inventario físico                                                                  | `/stock/inventario`                                  | ✅                               |
| Eventual | Nueva versión de receta                                                            | `/produccion/receta`                                 | ✅                               |
| Eventual | Corte de luz / freezer fuera de rango: registrar acción correctiva y retener lotes | `/planta/temperaturas`, `/calidad/reclamos`          | ✅                               |

## Operarios — J.T., S.G., E.A., S.R. (tablet de planta, con guantes)

| Momento         | Tarea                                                                 | Pantalla                                   | Estado            |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------ | ----------------- |
| Inicio          | Entrar con PIN; ver mis tareas                                        | `/login/planta`, `/planta/tareas`          | ✅                |
| Producción      | Consumos por lote, pesadas, envasado, etiquetas (también sin señal)   | `/planta/produccion`, `/planta/envasado`   | ✅                |
| Producción      | Iniciar / pasar a congelado sin señal                                 | `/planta/produccion`                       | ⚠️ solo con señal |
| Limpieza y frío | Registrar limpieza y temperaturas                                     | `/planta/limpieza`, `/planta/temperaturas` | ✅                |
| Eventual        | **Recibir mercadería** del proveedor (lote, vencimiento, temperatura) | — (solo escritorio, sin permiso)           | ❌                |
| Eventual        | **Avisar una falla** de la Biscomatic u otro equipo                   | —                                          | ❌                |
| Semana          | **Contar el inventario** en la tablet                                 | — (sin permiso)                            | ❌                |
| Siempre         | Capacitación de mi puesto y de otros                                  | `/capacitacion`                            | ✅                |

## Logística — chofer (celular)

| Momento  | Tarea                                                                                | Pantalla                    | Estado |
| -------- | ------------------------------------------------------------------------------------ | --------------------------- | ------ |
| Salida   | Ruta del día por zona, retiros en proveedores; iniciar con km                        | `/despacho/rutas/[id]`      | ✅     |
| Entregas | Remito con lotes, firma o foto; rechazo y entrega parcial; cambio de lote con motivo | `/despacho/remitos/[id]`    | ✅     |
| Entregas | Cobrar en ruta (efectivo, transferencia, cheque)                                     | `/cobranzas/ruta/[routeId]` | ✅     |
| Regreso  | Cerrar ruta (km, combustible, temperatura)                                           | `/despacho/rutas/[id]`      | ✅     |
| Regreso  | **Rendir el efectivo y los cheques cobrados** contra lo registrado                   | —                           | ❌     |

## Local — 2 empleadas (celular o PC)

| Momento   | Tarea                                                                      | Pantalla | Estado |
| --------- | -------------------------------------------------------------------------- | -------- | ------ |
| Apertura  | Ver stock del local y **qué se está por agotar según la demanda**          | `/local` | ✅     |
| Apertura  | **Pedir reposición a la planta** (la jefa la envía en `/stock/reposicion`) | `/local` | ✅     |
| Venta     | Vender chipá **y otros productos** (gaseosas, elaborados con chipá)        | `/local` | ✅     |
| Venta     | Cobrar en efectivo, transferencia, **tarjeta o QR**                        | `/local` | ✅     |
| Venta     | **Anular una venta cargada por error**                                     | `/local` | ✅     |
| Recepción | **Ingresar mercadería de reventa** (gaseosas) que trae el proveedor        | `/local` | ✅     |
| Cierre    | Cierre de caja por medio de pago                                           | `/local` | ✅     |

## Responsable técnico (PC, solo lectura)

| Tarea                                         | Pantalla                | Estado |
| --------------------------------------------- | ----------------------- | ------ |
| Registros BPM del mes, cargas tardías, huecos | `/calidad`              | ✅     |
| Trazabilidad y simulacro                      | `/calidad/trazabilidad` | ✅     |
| Exportar planillas para ASSAL                 | `/calidad/exportar`     | ✅     |
| Mantenimiento por equipo                      | `/mantenimiento`        | ✅     |

## Contadora (PC, solo lectura)

| Tarea                                          | Pantalla                            | Estado |
| ---------------------------------------------- | ----------------------------------- | ------ |
| Compras del mes y exportación                  | `/compras`                          | ✅     |
| Facturas emitidas, cobros, importación de ARCA | `/cobranzas`, `/cobranzas/importar` | ✅     |

## Transversal

| Tarea                                                    | Estado     |
| -------------------------------------------------------- | ---------- |
| Modo noche                                               | ✅         |
| Cambiar mi contraseña / mi PIN                           | ❌         |
| Cada rol ve solo lo que necesita (ver "Accesos por rol") | ⚠️ revisar |

## Accesos por rol (revisión)

Criterio: cada rol ve en el menú solo lo que usa en su día a día; lo que necesita de otros módulos lo
obtiene dentro de su propia pantalla (p. ej. el local elige un cliente desde la venta, sin ver el listado de clientes).

| Rol              | Cambio                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Local            | Sin Clientes, Pedidos ni Stock general: ve el stock del local y elige clientes desde su pantalla |
| Logística        | Sin Cobranzas ni Stock general: cobra desde la ruta; ve pedidos y direcciones                    |
| Operario         | + recibir mercadería, avisar fallas y contar inventario desde la tablet                          |
| Local, Logística | + avisar fallas (vehículo, freezer del local)                                                    |
