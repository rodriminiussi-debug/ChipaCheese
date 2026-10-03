# Relevamiento Chipa Cheese (Pacon SRL) — Base para el sistema de gestión

Sep 30, 2026 · @Rodrigo Miniussi

## Resumen ejecutivo

Chipa Cheese (Pacon SRL) tiene una planta con capacidad para crecer, pero opera sin datos: no sabe cuánto gana, cuánto stock tiene ni cuánto le deben. El sistema que se propone ataca eso primero, y después la dependencia de una sola persona.

**Hallazgos clave**

- **Capacidad ociosa de \~1/3.** Una receta de 75 kg de fécula rinde \~150 kg de producto, se amasa en dos tandas y se congela durante la noche. El techo es \~150 kg/día y hoy producen \~100 kg/día.
- **Punto único de falla en la madre.** Ella dosifica leche y sal, maneja la batidora, recibe los pedidos en su WhatsApp personal, decide las compras y sabe el stock. Si falta, la planta se desordena.
- **Registros BPM bien diseñados pero en papel.** Se completan a destiempo y no están vinculados entre sí: rastrear un lote lleva más de 15 minutos.
- **Costeo con errores.** El Excel (OpenOffice) usa un rendimiento inflado, una receta desactualizada y una fórmula de ganancia que da −$9,8M. Los precios se fijan sin costo al día.
- **La ganancia percibida no cierra.** Con los números del propio Excel, el negocio dejaría del orden de $3M/mes en total, frente a los \~$9M que los socios creen retirar. Hay que validarlo con un resultado mensual real.
- **Coordinación informal.** Pedidos, entregas de proveedores, cobranzas y reparto se manejan por WhatsApp, cuaderno y memoria.

**Propuesta.** Un sistema de gestión de 8 módulos: pedidos, compras con lectura de facturas por IA, stock y cobertura de materia prima, producción y lotes, despacho y trazabilidad, cuentas corrientes, BPM y mantenimiento, y un tablero para Nahuel. Se implementa en 3 fases en \~6 meses: primero ordenar datos y procesos, después la app en tablet y celular, y por último crecer con precios por canal y producción nivelada.

## Alcance y metodología

El relevamiento se hizo el 30/09/2026 en la planta, con entrevistas, observación directa y fotos de los registros. Su objetivo es dar la base funcional para diseñar el sistema de gestión.

| Fuente                                                      | Qué aportó                                              | Confianza                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Entrevista con Nahuel y la familia                          | Canales, clientes, precios, roles, cobranzas, expansión | Media: muchas respuestas son estimaciones ("más o menos", "no lo saben") |
| Observación de planta                                       | Flujo de elaboración, envasado, pizarrón de tareas      | Alta                                                                     |
| Registro de elaboración (26/08 y 01/09)                     | Receta real, lotes de materia prima, pesadas por forma  | Media: letra manuscrita                                                  |
| Registros BPM (despacho, limpieza, reclamos, mantenimiento) | Campos, frecuencia de uso, huecos                       | Media                                                                    |
| Archivo GASTOS general.ods (fotos de pantalla)              | Compras de insumos, costeo 07/04 y 29/09, gastos fijos  | Media: números leídos de fotos del monitor                               |
| Pizarrón de producción                                      | Asignación de tareas, stock de producto terminado       | Alta para tareas, baja para cifras                                       |

**Límites.** No hay registros de ventas por cliente, cobranzas ni costos de reparto: esos datos no existen hoy en ningún soporte. Las cifras económicas de este informe son órdenes de magnitud y se validan con los datos pendientes de la última sección.

## La empresa

Pacon SRL produce chipá crudo congelado bajo la marca Chipa Cheese: \~100 kg por día, vendidos en Rosario, Funes y Pueblo Esther por reparto propio y en un local comercial.

### Productos

| Producto                             | Presentación                         | Canal principal                                           | Notas                                       |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| Chipá (tapitas, aritos, lengüitas)   | Bolsa 0,5 kg, surtida o de una forma | Kioscos, dietéticas, supermercados, local                 | Producto principal                          |
| Chipá granel                         | Bolsa 5 kg por forma                 | Bares, clubes, restaurantes; supermercados que fraccionan | Se pide por forma ("5 kg de tapitas")       |
| Sándwich de chipá JyQ ("Chisanwich") | Pack                                 | Minoristas                                                | \~180 g de masa por pack; costeo incompleto |
| Pizzetas                             | Subproducto                          | Sin dato                                                  | Se hacen con el recorte de masa del formado |

El pizarrón usa códigos de stock (SW, C500, SWG, C granel) que hay que confirmar y convertir en SKUs.

### Canales, precios y cobro

| Canal                                             | Clientes de ejemplo                           | Precio por bolsa 0,5 kg            | Cobro                                           |
| ------------------------------------------------- | --------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Supermercados                                     | Arcoiris, La Reina                            | Más bajo que revendedor (sin dato) | Cheque a 30 días (La Reina)                     |
| Revendedores (kioscos, dietéticas, bares, clubes) | La Esperanza, Club Náutico, Vía Dolce y otros | \~$4.200 mayorista                 | Efectivo, transferencia, plazos anotados a mano |
| Local propio (2 empleadas)                        | Público                                       | \~$4.800 minorista                 | Efectivo, transferencia                         |

Los nombres de clientes surgen de los registros de despacho y reclamos, con legibilidad parcial.

**Clientes perdidos y por qué**

- Supermercados Dar: querían fijar el precio de venta al público.
- Empleados de Comercio: la forma de pago era demasiado compleja.
- Un cliente de volumen: ocupaba \~70% de la capacidad a un precio muy bajo.
- Supermercados que compran granel para fraccionar le compran hoy a una empresa de La Plata.

### Capacidad productiva

- **Receta base:** 75 kg de fécula, \~163,5 kg de ingredientes y \~150 kg de producto pesado. El registro del 01/09 suma 70,6 kg de tapitas, 10,1 kg de aritos y 68,6 kg de lengüitas: 149,3 kg.
- **Tandas:** se amasa en dos tandas de \~75 kg, que es lo que entra en las máquinas.
- **Congelado:** el abatidor (F1 y F2) trabaja toda la noche. Al día siguiente se retira, se embolsa y arranca la próxima producción. Es el cuello de botella.
- **Techo:** \~150 kg/día. Promedio actual: \~100 kg/día. Mínimo por tanda: 75 kg.
- **Pedido grande típico:** 850 bolsas de 0,5 kg = 425 kg, casi 3 días de capacidad plena.
- **Vida útil declarada:** 6 meses congelado.

### Equipamiento

| Equipo                          | Uso                                                |
| ------------------------------- | -------------------------------------------------- |
| Batidora                        | Batido de huevos, manteca y lácteos                |
| Amasadora                       | Amasado en dos tandas                              |
| Formadora de chipá (Biscomatic) | Formado de tapitas, aritos y lengüitas             |
| Freezers verticales F1 y F2     | Abatidor, congelado nocturno                       |
| Freezers horizontales F3 y F4   | Almacenamiento de producto terminado               |
| Heladera vertical               | Materia prima refrigerada                          |
| Selladora neumática y balanza   | Envasado con control de peso                       |
| Rallador de queso               | Preparado de reggianito                            |
| Vehículo con equipo de frío     | Reparto a −20 °C y retiro de insumos               |
| PC con OpenOffice Calc          | Costeo y compras                                   |
| Pizarrón                        | Asignación de tareas y stock de producto terminado |

## Organización y roles

La empresa la llevan tres socios de una familia, con 4 operarios de planta, 2 empleadas en el local y apoyo externo. No hay organigrama, descripciones de puesto ni reemplazos definidos.

| Rol                               | Persona                                        | Qué hace hoy                                                                                                                           | Si falta                    |
| --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Dueño, comercial y administración | Nahuel                                         | Llama a clientes para ver su stock, fija precios, lleva el Excel, hace contactos comerciales                                           | "No pasa tanto"             |
| Jefa de producción                | Madre (firma A.F. en los registros, a validar) | Asigna tareas, sigue la receta, dosifica leche y sal, maneja la batidora, recibe pedidos por WhatsApp, decide compras, conoce el stock | La planta se desordena      |
| Logística                         | Padre                                          | Único chofer, arma la ruta por zona, retira insumos en proveedores                                                                     | Sin reparto                 |
| Operarios de planta               | J.T., S.G., E.A., S.R.                         | Preproducción, máquinas, embolsado, limpieza                                                                                           | Según la tarea (ver matriz) |
| Envasado                          | 1 persona                                      | Pesa y sella con selladora neumática                                                                                                   | Sin dato                    |
| Local                             | 2 empleadas                                    | Venta al público y mayorista, anotan ventas                                                                                            | Sin dato                    |
| Supervisor de registros           | N.R. (a validar)                               | Firma todos los registros BPM                                                                                                          | Sin dato                    |
| Externos                          | Responsable técnico, contadora                 | BPM y habilitaciones; impuestos                                                                                                        | —                           |

### Matriz de tareas del pizarrón

| Etapa         | Tarea                                 | Responsables              |
| ------------- | ------------------------------------- | ------------------------- |
| Preproducción | Cortado y rallado de queso reggianito | J.T.                      |
| Preproducción | Huevos                                | S.G. / E.A.               |
| Preproducción | Cortado de queso barra                | S.G. / S.R.               |
| Preproducción | Manteca                               | S.G. / S.R. / E.A.        |
| Preproducción | Leche                                 | A.F.                      |
| Preproducción | Sal                                   | A.F.                      |
| Preproducción | Mandioca (fécula)                     | J.T. / E.A.               |
| Máquinas      | Batidora                              | A.F.                      |
| Máquinas      | Amasadora                             | E.A.                      |
| Máquinas      | Biscomatic: manejo                    | E.A.                      |
| Máquinas      | Biscomatic: recepción                 | S.G. / S.R.               |
| Máquinas      | Biscomatic: acomodo en bandejas       | J.T.                      |
| Terminación   | Retiro y embolsado a granel           | S.G. / S.R.               |
| Terminación   | Sellado y loteado                     | A.F. / E.A. / S.G. / S.R. |
| Terminación   | Acopio en freezer                     | J.T.                      |
| Limpieza      | Moldes y útiles; batidora; bandejas   | J.T.                      |
| Limpieza      | Amasadora y sector                    | E.A.                      |
| Limpieza      | Biscomatic                            | S.R.                      |
| Limpieza      | F1 y F2 (turnos semanales)            | J.T. / E.A.               |
| Limpieza      | Pisos (turnos diarios)                | Rotativo                  |

### Dependencias críticas

- **A.F.** es la única en leche, sal y batidora: toda la dosificación de la receta pasa por una persona.
- **E.A.** es el único en amasadora y manejo de la Biscomatic.
- **J.T.** es el único en rallado de reggianito y acopio en freezer.
- Tres puestos críticos sin reemplazo. El pizarrón ya es una matriz de tareas; falta convertirla en matriz de polivalencia (quién sabe hacer qué y quién reemplaza a quién).

## Procesos actuales (AS-IS)

Los procesos físicos funcionan; lo que falla es la información entre ellos. Cada proceso se describe como está hoy, sus problemas y lo que el sistema tiene que resolver.

### 1. Toma de pedidos

- **Hoy:** los clientes escriben al WhatsApp personal de la madre, que pasa el pedido a un cuaderno. Nahuel llama o escribe a los clientes para saber cuánto stock les queda; conoce la frecuencia de compra "más o menos". En envasado se trabaja con una hoja manuscrita del día (cliente y cantidad: bolsas de 5 kg por forma, bolsas de 500 g).
- **Problemas:** no hay fecha de entrega comprometida, la comunicación se cruza entre personas y no hay historial por cliente. Los pedidos grandes (850 bolsas) llegan de un día para el otro.
- **El sistema debe:** registrar todo pedido en un solo lugar con estado y fecha comprometida, mostrar el historial y la frecuencia de cada cliente y avisar cuándo reponer.

### 2. Compras y recepción de materia prima

- **Hoy:** hay 1 o 2 proveedores por insumo. La madre decide qué comprar según lo que va faltando, con algunos pedidos periódicos. Uno coordina con el proveedor por WhatsApp y otro en persona; el padre retira insumos durante el reparto. Nahuel carga las compras en la pestaña Insumos: insumo, proveedor, fecha, precio, cantidad y total, con el IVA calculado a mano.
- **Proveedores identificados:** Leo Pelle (quesos barra y reggianito, fécula, sal, leche, manteca, queso feteado), Cotar (leche), Mancinelli (huevo, jamón), Jorge (manteca).
- **Problemas:** no se sabe cuándo llega cada entrega, no se comparan precios, la carga es tediosa y no se sabe cuánto se gastó en el mes.
- **El sistema debe:** cargar facturas por foto, calcular el IVA, guardar el historial de precios por insumo y proveedor, registrar pedidos a proveedor con fecha esperada y recibir la mercadería con lote y vencimiento.

### 3. Planificación de producción

- **Hoy:** la madre decide qué producir según el mínimo de 75 kg por tanda y los pedidos que entran. El pizarrón asigna tareas y anota el stock de producto terminado a mano.
- **Problemas:** no hay plan semanal ni stock mínimo por producto, y un pedido grande desordena toda la semana.
- **El sistema debe:** proponer el plan diario según pedidos, stock y capacidad de 150 kg/día, y calcular la fecha posible de entrega de un pedido grande.

### 4. Elaboración

- **Hoy:** preproducción (pesado y preparado), batido, amasado en dos tandas, formado en la Biscomatic y bandejas al abatidor. Se pesa todo. La receta está en el Excel y en la cabeza de la madre, que corrige a los operarios sobre la marcha. El recorte de masa se usa para pizzetas y los excedentes se donan.
- **Registro:** planilla de elaboración en papel con materia prima, lote y vencimiento de cada insumo y las pesadas por forma.
- **Problemas:** la leche va de 18 a 28 L en tandas iguales sin criterio escrito. No se registra rendimiento ni merma, y la dosificación depende de una persona.
- **El sistema debe:** tener una receta maestra con rangos y versiones, registrar cada tanda con consumo real contra teórico y calcular el rendimiento.

### 5. Congelado

- **Hoy:** el abatidor (F1 y F2) congela durante toda la noche; las temperaturas se anotan en papel.
- **Problemas:** es el cuello de botella y no hay alarma ante fallas o cortes de luz.
- **El sistema debe:** usar la capacidad del abatidor como restricción del plan y registrar temperaturas con alerta.

### 6. Envasado y loteo

- **Hoy:** una persona embolsa, pesa y sella con selladora neumática. En el registro de elaboración el lote es la fecha de vencimiento (elaboración + 6 meses). En despacho aparecen números tipo 1210–1220, que también figuran en el campo "cantidad" del registro de elaboración.
- **Problemas:** no está claro cuál es el identificador de lote, y no se cuentan bolsas por producto. Los reclamos históricos son por bolsas rotas, mal selladas o sin etiqueta.
- **El sistema debe:** registrar bolsas por producto y lote e imprimir la etiqueta con lote y código QR.

### 7. Stock de materia prima y producto terminado

- **Hoy:** no hay inventario salvo el que se anota para el loteo. La madre sabe "más o menos" para cuántos días alcanza. El producto terminado está en F3 y F4 y se anota en el pizarrón, que se borra. Del local no se conoce el stock.
- **El sistema debe:** llevar entradas y salidas, calcular la cobertura en días y el punto de pedido, y ubicar el producto terminado por depósito y lote.

### 8. Despacho y reparto

- **Hoy:** un vehículo con frío (−20 °C medido en el trayecto) y un chofer, el padre. Arma la ruta por zona sin medir km ni horas y la combina con el retiro de insumos. El registro de despacho BPM se completa después, no en el momento. La ruta del 30/09 salió con 25 kg.
- **Problemas:** el costo del reparto es desconocido ("gastos ocultos") y hay rutas chicas.
- **El sistema debe:** armar la hoja de ruta desde los pedidos, generar el remito con lote y registrar km, horas y costo de cada salida.

### 9. Facturación y cobranzas

- **Hoy:** se factura desde la web de ARCA y las facturas se mandan por WhatsApp. Se cobra en efectivo, por transferencia o con cheque (La Reina, a 30 días); algunos clientes tienen plazo o pagan contra factura. Todo se anota a mano.
- **Problemas:** no se sabe cuánto deben los clientes.
- **El sistema debe:** llevar cuentas corrientes, vencimientos y cheques en cartera.

### 10. Local comercial

- **Hoy:** dos empleadas atienden y anotan las ventas.
- **Problemas:** no se conoce la facturación ni el stock del local.
- **El sistema debe:** registrar las ventas del local y tratarlo como un depósito más.

### 11. Calidad y BPM

- **Hoy:** tienen RNE, RNPA y habilitación de ASSAL, con inspección cada 6 meses y responsable técnico. No tienen HACCP. Ante un corte de luz no hay plan: se reacomoda la producción.
- **Problemas:** la planilla de limpieza de agosto solo tiene marcados los días 3 y 4, aunque hubo producción. Rastrear un lote lleva más de 15 minutos.
- **El sistema debe:** llevar los registros en tablet con fecha, hora y usuario, trazar un lote en segundos y exportar los registros para la inspección.

### 12. Mantenimiento

- **Hoy:** hay un registro de trabajos desde 2023, con preventivos esporádicos y correctivos repetidos en la Biscomatic (cambio y corte de alambre).
- **Problemas:** no hay plan con frecuencias por equipo.
- **El sistema debe:** tener un plan preventivo por equipo, con avisos y registro de cada intervención.

## Registros y planillas existentes

Hay 10 soportes de información y ninguno está conectado con otro. Sus campos son la base del modelo de datos: el sistema los reemplaza uno a uno sin cambiar lo que ASSAL ya conoce.

| Registro                   | Soporte                      | Campos                                                                                                                                                                             | Uso real                                                      | Qué reemplaza en el sistema |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------- |
| Registro de elaboración    | Papel, 1 por día             | Producto, lote/vencimiento, turno, responsable, supervisor, fecha, cantidad elaborada, materia prima (cantidad, lote, vencimiento), pesadas por forma (tapitas, aritos, lengüitas) | Completo; el campo "cantidad" a veces lleva el número de lote | Módulo Producción y lotes   |
| Registro de despacho (BPM) | Papel                        | Producto, lote, fecha de despacho, cantidad, destino, transporte/patente, responsable                                                                                              | Se completa después del despacho                              | Módulo Despacho             |
| Control de limpieza        | Papel, mensual               | Sector y elemento × día del mes; marca de limpieza correcta o a profundizar                                                                                                        | Agosto: solo días 3 y 4 marcados                              | Módulo BPM                  |
| Reclamos y devoluciones    | Papel, versión 2022          | Fecha, cliente, cantidad, lote, vencimiento, motivo, acción sobre cliente, acción sobre producto, supervisor                                                                       | \~10 reclamos entre 2023 y 2025                               | Módulo BPM                  |
| Trabajos de mantenimiento  | Papel, versión 2022          | Área, equipo, preventivo/correctivo, actividad, fecha, responsable, supervisor                                                                                                     | Desde 2023, sin frecuencias                                   | Módulo Mantenimiento        |
| Temperaturas               | Papel                        | Sin relevar                                                                                                                                                                        | Sin relevar                                                   | Módulo BPM                  |
| Hoja de pedidos del día    | Hoja manuscrita              | Cliente, cantidad, presentación, forma                                                                                                                                             | Guía para envasado                                            | Módulo Pedidos              |
| Cuaderno de pedidos        | Cuaderno                     | Pedidos pasados desde WhatsApp                                                                                                                                                     | Sin relevar                                                   | Módulo Pedidos              |
| Pizarrón de producción     | Pizarrón                     | Tareas por persona, turnos de limpieza, stock de producto terminado                                                                                                                | Diario; el stock se borra                                     | Planificación y stock       |
| GASTOS general.ods         | OpenOffice Calc, 47 pestañas | Servicios, gastos varios, insumos, resúmenes, una pestaña de costeo por fecha desde 2022                                                                                           | Costeo cada 2–3 meses; sin backup                             | Compras, costeo y tablero   |

**Qué se conserva.** Los formularios BPM tienen los campos correctos. El sistema tiene que respetarlos y poder imprimirlos en el mismo formato para la inspección.

## Análisis del Excel de costos

Una bolsa de 0,5 kg cuesta \~$3.210 y los lácteos son el 76% de los ingredientes. El Excel llega a un número parecido, pero con errores que distorsionan el precio por kg, el sándwich y la ganancia.

### Receta y costo de una producción (pestaña 29/09/2026)

| Ingrediente             | Receta por kg de fécula | Excel 29/09  | Registro 26/08 | Registro 01/09 | Precio 29/09 | Costo por producción | % del costo |
| ----------------------- | ----------------------- | ------------ | -------------- | -------------- | ------------ | -------------------- | ----------- |
| Queso barra (Tybo/Maki) | 300 g                   | 22,5 kg      | 22 kg          | 22 kg          | $9.880/kg    | $222.292             | 28,1%       |
| Queso reggianito        | 200 g                   | 15 kg        | 15 kg          | 15 kg          | $13.431/kg   | $201.465             | 25,4%       |
| Manteca                 | 200 g                   | 15 kg        | 10 kg          | 15 kg          | $9.800/kg    | $147.000             | 18,6%       |
| Fécula de mandioca      | 1.000 g                 | 75 kg        | 75 kg          | 75 kg          | $1.728/kg    | $129.597             | 16,4%       |
| Huevo                   | 240 g                   | 18 kg        | 18 kg          | 18 kg          | $3.222/kg    | $58.000              | 7,3%        |
| Leche                   | 400 g                   | 30 L         | 28 L           | 18 L           | $1.066/L     | $31.983              | 4,0%        |
| Sal                     | 30 g                    | 2,25 kg      | 1,9 kg         | 1,9 kg         | $708/kg      | $1.593               | 0,2%        |
| **Total**               |                         | **163,5 kg** |                |                |              | **$791.930**         | **100%**    |

La receta real no coincide con la costeada en leche, manteca y sal. La receta maestra del sistema tiene que salir de la planta, no del Excel.

### Costo por bolsa de 0,5 kg

| Concepto                                 | Por producción (\~297 bolsas) | Por bolsa  |
| ---------------------------------------- | ----------------------------- | ---------- |
| Ingredientes                             | $791.930                      | $2.666     |
| Envase (bolsa + etiqueta)                | —                             | $140       |
| Mano de obra (4 personas × 6 h × $5.000) | $120.000                      | $404       |
| **Costo directo**                        |                               | **$3.210** |

| Precio de venta                | Margen por bolsa | Margen % |
| ------------------------------ | ---------------- | -------- |
| $4.200 (mayorista)             | $990             | 24%      |
| $4.500 (usado en el Excel)     | $1.290           | 29%      |
| $4.800 (minorista en el local) | $1.590           | 33%      |

El precio a supermercados es más bajo que $4.200 y no se relevó; su margen puede ser muy chico.

### Errores detectados en el Excel

1. **Rendimiento inflado.** Toma 163,5 kg de producto, que es la suma de los ingredientes. Lo pesado real es \~149 kg. El costo por kg queda en $4.844 cuando es \~$5.330, un 9% abajo.
2. **Rendimiento inconsistente.** El costo por bolsa usa 297 bolsas (148,5 kg), pero el precio por kg y el sándwich usan 163,5 kg.
3. **Receta desactualizada**, como muestra la tabla de arriba.
4. **Mano de obra dudosa.** $5.000/h parece desactualizado. En abril se cargaban 2 días por producción y en septiembre 1.
5. **El envase no suma** al "valor de bolsa neto".
6. **Celdas de precio sin uso.** "Precio revendedor" y "público" se calculan pero no se usan: las ventas se proyectan a $4.500 (septiembre) y $5.000 (abril).
7. **Ganancia mal calculada.** La celda da −$9.793.384 porque multiplica el costo por 15 producciones y la venta por 4 (1.188 bolsas). En septiembre la venta mensual cargada es de 891 bolsas, que equivalen a 3 producciones.
8. **Sándwich subcosteado.** El "Chisanwich" tiene el jamón (5 fetas, 100 g) y el queso (6 fetas, 100 g) en $0. Solo cuenta \~180 g de masa ($872) y el precio para revendedor sale de multiplicar eso por 3.
9. **Gastos fijos incompletos.** La pestaña de abril suma $1.040.000/mes: alquiler $300.000, contadora $200.000, luz $200.000, ASSAL $100.000, seguro $100.000, agua $100.000, desinfección $40.000. Faltan vehículo, combustible, sueldos del local, impuestos y amortizaciones.
10. **Estructura frágil.** Una pestaña copiada por cada fecha de costeo desde 2022, sin backup. La pestaña Insumos no alimenta al costeo.

### Estimación de resultado mensual

Supuestos: 100 kg/día, 22 días, 4.400 bolsas equivalentes y precio promedio de $4.300.

| Concepto                                                   | $/mes           |
| ---------------------------------------------------------- | --------------- |
| Ventas                                                     | 18.900.000      |
| Ingredientes y envase                                      | −12.350.000     |
| Mano de obra de planta                                     | −2.640.000      |
| Gastos fijos del Excel                                     | −1.040.000      |
| **Resultado antes de reparto, local, impuestos y retiros** | **\~2.900.000** |

Los socios estiman retirar \~$3M cada uno, \~$9M en total. Hay tres explicaciones posibles: venden más volumen del que creen, el costo real es menor o no ganan lo que piensan. El primer entregable del proyecto es un resultado mensual real que responda esto.

## Problemas y oportunidades

Las tres prioridades son saber si el negocio gana, bajar la dependencia de la madre y ordenar pedidos y stock. Sin esas bases, crecer hacia Buenos Aires o exportar multiplica el desorden.

| #   | Problema                                                     | Consecuencia                                                                           | Mejora                                                                               | Fase |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---- |
| 1   | No se conoce la rentabilidad                                 | Decisiones de precio, clientes y retiros a ciegas                                      | Resultado mensual y costeo actualizado                                               | 1    |
| 2   | Precios sin costo al día ni margen por canal                 | Se perdieron clientes sin saber si convenían; posible venta bajo costo a supermercados | Lista de precios por canal con margen objetivo                                       | 1    |
| 3   | La receta y la dosificación dependen de la madre             | Si falta, la planta se desordena; variabilidad de producto                             | Receta maestra con rangos, kits de pesado, matriz de polivalencia                    | 1    |
| 4   | Pedidos dispersos en WhatsApp personal y cuaderno            | Entregas sin fecha, comunicación cruzada                                               | WhatsApp Business único y módulo de pedidos                                          | 1–2  |
| 5   | El costo del reparto es desconocido                          | Rutas de 25 kg que quizá pierden plata                                                 | Días fijos por zona, pedido mínimo, registro de km y horas                           | 1–2  |
| 6   | Stock de materia prima desconocido y compras reactivas       | Faltantes, compras urgentes, capital mal usado                                         | Stock con cobertura en días y punto de pedido                                        | 2    |
| 7   | Carga manual de facturas con IVA a mano                      | Horas de Nahuel, errores, datos atrasados                                              | Lectura de facturas por IA desde una foto                                            | 2    |
| 8   | Cobranzas sin control                                        | No se sabe cuánto deben; riesgo de incobrables                                         | Cuentas corrientes y cheques en cartera                                              | 2    |
| 9   | Registros BPM a destiempo; trazabilidad de más de 15 minutos | Riesgo en inspecciones y ante un retiro de producto                                    | Registros digitales con usuario y hora; trazabilidad por QR                          | 2    |
| 10  | Mantenimiento correctivo                                     | Paradas de la Biscomatic, riesgo en el frío                                            | Plan preventivo por equipo con avisos                                                | 2    |
| 11  | Local sin control de ventas ni stock                         | No se sabe qué deja el local                                                           | Ventas y stock del local en el sistema                                               | 2    |
| 12  | Pedidos grandes desordenan la producción                     | Atrasos y estrés en la planta                                                          | Producción nivelada a 150 kg/día y stock de seguridad de los productos que más salen | 3    |
| 13  | Supermercados le compran granel a un competidor de La Plata  | Facturación perdida                                                                    | Oferta de granel para supermercados con precio calculado                             | 3    |
| 14  | Expansión a Buenos Aires y exportación sin base              | Negociar sin conocer el costo                                                          | Piloto con distribuidor después de la fase 2; estudio de mercado en Madrid           | 3    |

### Oportunidades que no están viendo

- **Capacidad ya pagada.** Producir 150 kg/día en lugar de 100 suma \~50% de volumen sin comprar máquinas. Con 6 meses de vida útil se puede producir para stock. Una semana de stock de seguridad (\~500 kg) inmoviliza \~$2,7M en ingredientes.
- **Clientes de volumen, bien calculados.** Un cliente a precio bajo conviene si paga más que el costo variable (\~$2.800 por bolsa) y ocupa solo la capacidad libre, no el 70% de la planta.
- **Compras de lácteos.** Quesos y manteca son el 72% del costo de ingredientes y casi todo sale de un solo proveedor. Un 5% menos en quesos baja \~2,7% el costo total de ingredientes.
- **El distribuidor de Buenos Aires hoy no cierra.** Si pide un 25% sobre $4.200, el precio queda en \~$3.150, por debajo del costo directo de $3.210. Primero hay que conocer y bajar el costo.
- **Exportar es un horizonte de 2 a 3 años.** Faltan habilitación SENASA para exportar, HACCP, requisitos de la UE para productos con lácteo y huevo (a confirmar con SENASA), importador y volumen para logística congelada. Un relevamiento de mercado en Madrid (tiendas latinas, precios del pan de queso brasileño congelado, 2 o 3 importadores) cuesta poco y da datos para decidir.

## Requerimientos del sistema

El sistema tiene que responder cuatro preguntas en cualquier momento: cuánto ganamos, qué tenemos, qué debemos producir y comprar, y dónde está cada lote. Además tiene que sacar la operación de la cabeza de la madre y del WhatsApp personal.

&#91;embedded content: módulos del sistema · cómo circula la información\]

Un pedido entra por M1, se produce en M4 consumiendo el stock de M3 (que alimentan las compras), sale por M5 con su lote y se cobra en M6. BPM registra y traza cada lote, y el tablero lee todos los módulos.

### Usuarios y permisos

| Rol                 | Quién                  | Dispositivo      | Qué hace en el sistema                                 | Acceso                 |
| ------------------- | ---------------------- | ---------------- | ------------------------------------------------------ | ---------------------- |
| Dirección           | Nahuel                 | PC y celular     | Tablero, precios, clientes, cobranzas, compras         | Todo                   |
| Jefa de producción  | Madre                  | Tablet y celular | Pedidos, plan, producciones, stock, compras de insumos | Todo menos finanzas    |
| Logística           | Padre                  | Celular          | Hoja de ruta, remitos, cobros en ruta, km y horas      | Despacho y cobros      |
| Operario            | J.T., S.G., E.A., S.R. | Tablet de planta | Pesadas, envasado, limpieza, temperaturas              | Solo carga de su tarea |
| Local               | 2 empleadas            | Celular o PC     | Ventas y stock del local                               | Local                  |
| Responsable técnico | Externo                | PC               | Consulta y exportación de registros BPM                | Lectura                |
| Contadora           | Externa                | PC               | Exportación de compras y ventas                        | Lectura                |

### Módulos y requerimientos funcionales

**M1. Pedidos y clientes**

1. RF-01. Ficha de cliente: razón social, CUIT, canal, lista de precios, zona, días de entrega, condición de pago, WhatsApp.
2. RF-02. Carga de un pedido en menos de 1 minuto desde el celular: cliente, productos, cantidades, fecha comprometida.
3. RF-03. Estados del pedido: recibido, confirmado, en producción, listo, despachado, entregado, facturado, cobrado.
4. RF-04. Historial y frecuencia promedio por cliente, con aviso de "cliente sin pedir hace X días".
5. RF-05. Pedido grande: fecha posible de entrega según stock de producto terminado y capacidad libre.
6. RF-06 (fase 3). Pedidos que entran por WhatsApp Business con catálogo.

**M2. Compras y proveedores**

1. RF-07. Ficha de proveedor con insumos, precios, plazo de entrega y condición de pago.
2. RF-08. Carga de factura por foto (WhatsApp o app): la IA extrae proveedor, fecha, número, ítems, cantidades, precio neto e IVA, y el usuario confirma.
3. RF-09. Historial de precios por insumo y proveedor, con variación mensual.
4. RF-10. Orden de compra con fecha esperada y responsable; un solo canal con cada proveedor.
5. RF-11. Recepción: cantidad real, lote y vencimiento del proveedor, temperatura de los refrigerados.
6. RF-12. Cuenta corriente con proveedores.

**M3. Stock y cobertura**

1. RF-13. Stock de materia prima = recepciones − consumos (receta × producción) ± ajustes de inventario.
2. RF-14. Cobertura en días por insumo y aviso al llegar al punto de pedido.
3. RF-15. Inventario físico semanal guiado en tablet, con diferencias registradas.
4. RF-16. Stock de producto terminado por producto, lote y ubicación (F3, F4, local, vehículo).
5. RF-17. Simulador: "¿alcanza la materia prima para producir X kg?".

**M4. Producción y lotes**

1. RF-18. Receta maestra por kg de fécula, con versiones, rangos (por ejemplo, leche) y ficha imprimible.
2. RF-19. Plan diario y semanal: kg y mezcla por forma según pedidos, stock mínimo y capacidad de 150 kg/día.
3. RF-20. Registro de producción en tablet: fecha, turno, responsables, lotes de materia prima usados (por QR o lista) y cantidades reales.
4. RF-21. Pesadas por forma, con cálculo de rendimiento y merma.
5. RF-22. Envasado: bolsas por producto, generación del lote de producto terminado y etiqueta con QR.
6. RF-23. Asignación de tareas del día (el pizarrón digital) y matriz de polivalencia.

**M5. Despacho y reparto**

1. RF-24. Hoja de ruta del día desde los pedidos listos, agrupada por zona, con los retiros en proveedores.
2. RF-25. Remito con lotes asignados automáticamente (vence primero, sale primero) y conformidad por firma o foto.
3. RF-26. Registro de cada salida: km inicial y final, horas, combustible, temperatura del equipo.
4. RF-27. Costo por ruta y por kg entregado.
5. RF-28. Registro de despacho BPM generado automáticamente.

**M6. Ventas, facturación y cobranzas**

1. RF-29. Listas de precios por canal, con margen calculado sobre el costo actual.
2. RF-30. Cuenta corriente por cliente: facturas, cobros, saldo y antigüedad de la deuda.
3. RF-31. Cobros en ruta (efectivo, transferencia, cheque), con banco, número y fecha de cobro de cada cheque.
4. RF-32. Importación de "Mis Comprobantes" de ARCA para conciliar facturas emitidas y recibidas. En fase 3, facturación electrónica integrada.
5. RF-33. Ventas del local: registro simple por venta y cierre de caja diario.

**M7. Calidad, BPM y mantenimiento**

1. RF-34. Registros digitales de limpieza, temperaturas (F1 a F4, heladera, vehículo) y reclamos, con usuario y hora automáticos. Completar un día pasado queda marcado como carga tardía.
2. RF-35. Trazabilidad en menos de 1 minuto: del lote terminado a los lotes de materia prima y proveedores, y a los clientes que lo recibieron.
3. RF-36. Exportación a PDF con el formato de las planillas actuales para ASSAL.
4. RF-37. Equipos con plan preventivo (frecuencia y tareas), avisos de vencimiento y órdenes correctivas con causa, repuesto y costo.
5. RF-38. Alerta de temperatura fuera de rango (en fase 3, con sensores).

**M8. Tablero y costeo**

1. RF-39. Costo por kg y por bolsa actualizado solo, con el último precio de compra y el rendimiento real.
2. RF-40. Resultado mensual: ventas por canal, costo de ventas, mano de obra, fijos, reparto y resultado.
3. RF-41. Indicadores de la sección de implementación.
4. RF-42. Carga mensual de gastos fijos y servicios.

### Reglas de negocio y cálculos

1. **Unidad de producción:** 1 receta = 75 kg de fécula ≈ 150 kg de producto, amasada en 2 tandas. Mínimo 75 kg de producto; máximo 150 kg/día por el abatidor.
2. **Consumo teórico** de un insumo = receta por kg de fécula × kg de fécula usados. Si el real se desvía más de un umbral a definir, el sistema avisa.
3. **Rendimiento** = kg pesados ÷ kg de ingredientes. Bolsas equivalentes = kg ÷ 0,5.
4. **Lote de producto terminado:** un único identificador (propuesta: AAMMDD + número de producción) con vencimiento = elaboración + 6 meses.
5. **Vence primero, sale primero:** el despacho asigna siempre el lote más próximo a vencer.
6. **Cobertura (días)** = stock ÷ consumo diario promedio de los últimos 30 días.
7. **Punto de pedido** = consumo diario × plazo de entrega del proveedor + stock de seguridad.
8. **Costo por kg** = suma de (cantidad de insumo × último precio sin IVA) ÷ kg reales producidos + mano de obra ÷ kg. Por bolsa se suma el envase.
9. **Precio por canal** = costo directo ÷ (1 − margen objetivo del canal).
10. **Fecha posible de un pedido grande** = primer día en que el stock terminado más la capacidad libre acumulada cubren el pedido.
11. **IVA:** se toma de la factura (21% o 10,5%); nunca se calcula a mano.

### Modelo de datos

| Entidad                | Campos clave                                                         | Se relaciona con                 |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------- |
| Cliente                | Razón social, CUIT, canal, zona, lista de precios, condición de pago | Pedido, Factura, Cobro, Reclamo  |
| Proveedor              | Razón social, CUIT, plazo de entrega, condición de pago              | Insumo, Compra                   |
| Insumo                 | Nombre, unidad, stock mínimo, precio vigente                         | Receta, Lote de materia prima    |
| Producto               | Código, forma, presentación, peso                                    | Receta, Lote terminado, Pedido   |
| Receta e ítems         | Versión, insumo, cantidad por kg de fécula, rango                    | Producto, Producción             |
| Compra e ítems         | Factura, fecha, insumo, cantidad, precio neto, IVA                   | Proveedor, Lote de materia prima |
| Lote de materia prima  | Lote del proveedor, vencimiento, cantidad recibida                   | Compra, Consumo                  |
| Producción             | Fecha, turno, responsables, kg de fécula                             | Consumo, Pesada, Lote terminado  |
| Consumo                | Lote de materia prima, cantidad real, cantidad teórica               | Producción                       |
| Pesada                 | Forma, kg                                                            | Producción                       |
| Lote terminado         | Identificador, vencimiento, bolsas por producto                      | Producción, Despacho             |
| Movimiento de stock    | Tipo, ítem, lote, ubicación, cantidad, origen                        | Todo lo que mueve stock          |
| Pedido e ítems         | Fecha comprometida, estado, producto, cantidad                       | Cliente, Despacho                |
| Ruta                   | Fecha, chofer, km, horas, costo                                      | Despacho                         |
| Despacho e ítems       | Remito, lote, cantidad, conformidad                                  | Pedido, Ruta, Lote terminado     |
| Factura y cobro        | Número, importe, vencimiento, medio, cheque                          | Cliente, Despacho                |
| Equipo y mantenimiento | Equipo, frecuencia, tarea, tipo, fecha, costo                        | Persona                          |
| Registros BPM          | Tipo (limpieza, temperatura, reclamo), valor, usuario, hora          | Equipo, Sector, Lote             |
| Persona y tarea        | Rol, habilidades, tarea asignada por día                             | Producción, Registros            |
| Gasto fijo             | Concepto, mes, importe                                               | Tablero                          |

### Integraciones

- **WhatsApp Business:** recibe fotos de facturas y, en fase 3, pedidos; envía remitos y facturas.
- **IA de visión:** lee facturas y, si hace falta, digitaliza planillas históricas.
- **ARCA:** importación de "Mis Comprobantes" y, en fase 3, facturación electrónica.
- **Google Maps:** rutas, km y tiempos.
- **Impresora de etiquetas:** lote, vencimiento y QR en cada bolsa o bulto.
- **Automatizaciones:** n8n o Make para el circuito WhatsApp → IA → base de datos.

### Requerimientos no funcionales

- **Planta:** tablet con botones grandes, que se pueda usar con guantes y con pocas pantallas. Si se corta la señal, guarda y sincroniza después.
- **Velocidad:** cargar un registro de planta tiene que llevar menos de 30 segundos.
- **Auditoría:** cada dato guarda usuario, fecha y hora, y cada edición su historial. Es clave para BPM.
- **Seguridad:** roles y permisos por usuario.
- **Respaldo:** backup automático diario en la nube.
- **Exportación:** a Excel y PDF.
- **Idioma y formato:** español, fechas y pesos argentinos.
- **Costo de operación:** bajo, del orden de decenas de dólares por mes en infraestructura.

### Arquitectura sugerida

Aplicación web instalable (React) sobre Supabase (base de datos Postgres, usuarios y archivos), publicada en Vercel. Es el mismo stack del sistema de trazabilidad de Iturrospe. Se usan códigos QR en las etiquetas de lote y en los equipos, y n8n o Make para WhatsApp e IA.

**Hacer o comprar.** Un ERP comercial (Tango, Odoo) cubre facturación y stock. Sin personalización no cubre la receta con rangos, los registros BPM de ASSAL ni el flujo en tablet de planta. Conviene compararlos antes de presentar la propuesta.

## Plan de implementación

Son tres fases en \~6 meses: ordenar datos y procesos sin software nuevo, construir el sistema empezando por producción y stock, y recién después crecer. Cada fase termina en una condición concreta antes de pasar a la siguiente.

### Fase 1: ordenar (semanas 1 a 4)

- [ ] Bajar "Mis Comprobantes" de ARCA (12 meses de emitidas y recibidas) y armar el resultado mensual real
- [ ] Validar la receta en planta pesando 3 producciones; ficha plastificada y kits de pesado por tanda
- [ ] Armar la matriz de polivalencia y entrenar un reemplazo para leche, sal y batidora
- [ ] Abrir un WhatsApp Business de la empresa y una planilla de pedidos con estados
- [ ] Planilla de compras con IVA automático y conteo semanal de materia prima
- [ ] Fijar días de reparto por zona y medir km y horas durante 2 semanas
- [ ] Copiar el archivo GASTOS general.ods y dejarlo con backup

**Condición para avanzar:** resultado mensual cerrado y receta validada.

### Fase 2: sistema (meses 2 a 4)

El orden va de lo que más dolor saca a lo que depende de ello:

1. Producción y lotes + stock y cobertura (M4 y M3): el corazón del sistema.
2. Compras con lectura de facturas por IA (M2).
3. Pedidos y clientes (M1).
4. Despacho, reparto y trazabilidad (M5).
5. Cuentas corrientes y cobranzas (M6).
6. Registros BPM y mantenimiento (M7).
7. Tablero y costeo automático (M8).

La tablet queda fija en planta. Durante el primer mes se mantiene el papel en paralelo y se capacita a cada usuario en su módulo.

**Condición para avanzar:** un mes completo sin planillas en papel y un simulacro de trazabilidad resuelto en menos de 1 minuto.

### Fase 3: crecer (mes 5 en adelante)

- Listas de precios por canal con margen objetivo.
- Producción nivelada a 150 kg/día y stock de seguridad de los productos que más salen.
- Oferta de granel para supermercados.
- Pedidos por WhatsApp Business y facturación electrónica integrada.
- Sensores de temperatura con alarma en los freezers.
- Piloto con un distribuidor de Buenos Aires, con el costo ya conocido.
- Relevamiento de mercado en Madrid (diciembre) y evaluación de HACCP.

### Indicadores

| Indicador                     | Cómo se calcula                         | Frecuencia     | Meta inicial                          |
| ----------------------------- | --------------------------------------- | -------------- | ------------------------------------- |
| Uso de capacidad              | kg producidos ÷ 150 kg                  | Semanal        | Subir desde \~67%                     |
| Rendimiento                   | kg pesados ÷ kg de ingredientes         | Por producción | Medir la base en fase 1               |
| Costo por bolsa               | Regla de negocio 8                      | Mensual        | Siempre actualizado                   |
| Margen por canal              | (precio − costo) ÷ precio               | Mensual        | Definir por canal                     |
| Ventas por canal y cliente    | Suma de pedidos entregados              | Semanal        | Medir la base                         |
| Entregas a tiempo y completas | Pedidos OK ÷ pedidos entregados         | Semanal        | Medir la base                         |
| Cobertura de materia prima    | Regla de negocio 6                      | Diaria         | Ningún insumo bajo el punto de pedido |
| Deuda de clientes             | Saldo total y por antigüedad            | Semanal        | Medir la base                         |
| Costo de reparto por kg       | Costo de la ruta ÷ kg entregados        | Mensual        | Medir la base                         |
| Tiempo de trazabilidad        | Simulacro                               | Trimestral     | Menos de 1 minuto                     |
| Registros BPM al día          | Registros cargados a tiempo ÷ esperados | Semanal        | 100%                                  |
| Preventivos cumplidos         | Hechos ÷ programados                    | Mensual        | 100%                                  |

### Manual de procesos

Se arma en paralelo desde el mes 2 y cada procedimiento se enlaza a su pantalla del sistema.

1. **Empresa:** productos, clientes, organigrama.
2. **Puestos:** dirección, jefa de producción, operario, envasado, logística y local, con responsabilidades, reemplazo e indicadores.
3. **Procedimientos:**
   1. Recepción de materia prima
   2. Pesado y preparado
   3. Elaboración y formado
   4. Congelado
   5. Envasado y loteo
   6. Almacenamiento
   7. Despacho y reparto
   8. Limpieza
   9. Mantenimiento
   10. Reclamos y retiro de producto
   11. Toma de pedidos
   12. Compras
   13. Cobranzas
   14. Cierre mensual
4. **Registros:** el formato de cada procedimiento.

**Método:** un video de 5 minutos por estación, transcripción y validación con quien hace la tarea.

## Pendientes y supuestos a validar

Antes de cerrar la propuesta del sistema faltan datos que cambian el alcance o el diagnóstico económico.

### Datos a conseguir

- [ ] Copia del archivo GASTOS general.ods completo (en pendrive), no fotos del monitor
- [ ] Un mes completo del cuaderno de pedidos
- [ ] "Mis Comprobantes" de ARCA de los últimos 12 meses
- [ ] Costo real de la nómina con cargas sociales (planta y local)
- [ ] Lista de precios vigente por canal, incluido el precio a supermercados
- [ ] Registro de temperaturas y hoja de reparto de una semana
- [ ] Costos del vehículo: combustible, seguro, mantenimiento, patente
- [ ] Días de producción por semana y kg reales de las últimas 4 semanas
- [ ] Capacidad en kg de F3, F4 y el depósito
- [ ] Retiros mensuales reales de los socios

### Supuestos a confirmar

- [ ] A.F. es la madre y N.R. es quien supervisa los registros (¿Nahuel o el responsable técnico?)
- [ ] La "tanda" de 75 kg es de producto amasado y una receta de 75 kg de fécula rinde \~150 kg
- [ ] Criterio de la leche: ¿se ajusta por textura? ¿Cuál es el rango aceptable?
- [ ] Identificador de lote de producto terminado: fecha de vencimiento o número 1210–1220
- [ ] Significado de los códigos del pizarrón (SW, C500, SWG, C granel) y lista completa de productos
- [ ] Qué parte de la venta se factura
- [ ] Stock y ventas del local: quién lo abastece y con qué frecuencia
- [ ] Plazo de entrega de cada proveedor
- [ ] Quién va a usar la tablet en planta y si hay wifi estable

### Riesgos del proyecto

- **Adopción:** si la madre no usa el sistema, no hay datos. Hay que empezar por lo que le saca trabajo a ella: pedidos y stock.
- **Doble carga:** mantener el papel en paralelo más de un mes cansa al equipo y el sistema queda de lado.
- **Datos de origen:** la IA lee facturas, pero la letra a mano de planta no es confiable. Lo que importa se carga en el momento, en la tablet.
