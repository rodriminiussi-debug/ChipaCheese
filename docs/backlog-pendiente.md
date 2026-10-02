# Backlog pendiente (límite de issues del plan Free)

Proyecto **Chipa Cheese — Sistema de Gestión** (P-ROD-4, equipo ROD). Son los 32 issues que no se pudieron crear en Linear porque el workspace llegó al límite de issues del plan Free. Cada entrada tiene todos los campos para crearla tal cual cuando se libere cupo.

**Cómo convertirlos:** crear cada issue en el equipo ROD y el proyecto P-ROD-4, con el título, labels, prioridad, estimación, milestone y épica padre indicados, y la descripción tal como está. Los códigos (P-01, F1-01, F3-01) se usan solo para las dependencias entre pendientes. Una vez creados, cargar las relaciones "Bloqueada por" y "Bloquea" con los ROD-xx reales.

**Épicas existentes (padres):** ROD-234 Plataforma · ROD-235 M1 · ROD-236 M2 · ROD-237 M3 · ROD-238 M4 · ROD-239 M5 · ROD-240 M6 · ROD-241 M7 · ROD-242 M8.

**Resumen (32):** Sprint 0: 12 técnicas de Plataforma + 8 spikes de Fase 1 (20) · Sprint 6: 2 · Sprint 7: 4 · Fase 3: 6.

Prioridad: 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.

---

## Milestone: Sprint 0 — Fundaciones

### Historias técnicas de Plataforma (padre ROD-234)

### P-01 · Monorepo pnpm + Turborepo y convenciones

- **Labels:** Técnica, Plataforma · **Prioridad:** 1 (Urgent) · **Estimación:** 3 · **Padre:** ROD-234 · **Bloqueada por:** ninguna · **Bloquea:** P-02, P-03, P-06, P-07, P-08, P-12

**Historia de usuario**
Como **equipo de desarrollo** quiero un monorepo pnpm + Turborepo con convenciones claras, para que todos los módulos compartan dominio, base de datos y configuración sin duplicar código.

**Criterios de aceptación**

- [ ] **Dado** un clon limpio del repositorio, **cuando** se ejecuta `pnpm install` y `pnpm build`, **entonces** compila sin errores todas las apps y paquetes (web, dominio, base de datos, configuración).
- [ ] **Dado** el monorepo, **cuando** se revisa su estructura, **entonces** existen `apps/web` (Next.js 16, App Router, React 19) y paquetes `packages/domain`, `packages/db` y `packages/config` (tsconfig, ESLint, Prettier compartidos).
- [ ] **Dado** cualquier paquete, **cuando** se ejecuta `pnpm typecheck`, **entonces** TypeScript corre en modo estricto (`strict: true`, sin `any` implícito) y falla ante errores.
- [ ] **Dado** un cambio en un paquete, **cuando** se ejecuta `turbo run build test`, **entonces** Turborepo reutiliza la caché de lo que no cambió.
- [ ] **Dado** el repositorio, **cuando** se hace un commit, **entonces** un hook valida el formato de commits convencionales y el lint de los archivos modificados.
- [ ] **Dado** el README, **cuando** una persona nueva lo sigue, **entonces** levanta el entorno local en menos de 15 minutos.

**Notas técnicas**
Entidades: ninguna (infraestructura). Stack: pnpm workspaces, Turborepo, Next.js 16, React 19, TypeScript estricto, Tailwind 4. Convenciones: ramas `feat/ROD-123-descripcion`, commits convencionales (ver documento "Definition of Done y flujo de trabajo"). Textos de la app en español, fechas y pesos argentinos.

### P-02 · Docker Compose: Postgres 16 + MinIO

- **Labels:** Técnica, Plataforma · **Prioridad:** 1 (Urgent) · **Estimación:** 2 · **Padre:** ROD-234 · **Bloqueada por:** P-01 · **Bloquea:** P-03, P-12

**Historia de usuario**
Como **equipo de desarrollo** quiero un Docker Compose con PostgreSQL 16 y MinIO, para trabajar en local con el mismo tipo de base de datos y almacenamiento de archivos que en producción.

**Criterios de aceptación**

- [ ] **Dado** Docker instalado, **cuando** se ejecuta `docker compose up -d`, **entonces** levantan Postgres 16 y MinIO con healthchecks en verde.
- [ ] **Dado** el servicio de Postgres, **cuando** se reinicia el contenedor, **entonces** los datos persisten en un volumen con nombre.
- [ ] **Dado** MinIO, **cuando** arranca, **entonces** crea automáticamente los buckets necesarios (facturas de compra, conformidades de entrega, etiquetas) con acceso privado.
- [ ] **Dado** el archivo `.env.example`, **cuando** se copia a `.env`, **entonces** contiene todas las variables necesarias (URL de base, credenciales de MinIO) solo con valores de desarrollo.
- [ ] **Dado** el repositorio, **cuando** se revisa, **entonces** no hay credenciales reales versionadas.
- [ ] **Dado** el compose, **cuando** se ejecuta `docker compose down -v`, **entonces** el entorno se limpia por completo para empezar de cero.

**Notas técnicas**
Entidades: ninguna. Imágenes `postgres:16` y `minio/minio`. En producción: Supabase (Postgres y Storage) con la misma interfaz S3. Los archivos (facturas por foto, fotos de conformidad) usan el cliente S3 compatible.

### P-03 · Esquema de base de datos Drizzle + migraciones + seed con datos del relevamiento

- **Labels:** Técnica, Plataforma · **Prioridad:** 1 (Urgent) · **Estimación:** 8 · **Padre:** ROD-234 · **Bloqueada por:** P-01, P-02 · **Bloquea:** P-04, P-05, P-08, P-11

**Historia de usuario**
Como **equipo de desarrollo** quiero el esquema completo del modelo de datos en Drizzle ORM con migraciones versionadas y un seed con los datos del relevamiento, para que todos los módulos trabajen sobre el mismo modelo y datos reales de ejemplo.

**Criterios de aceptación**

- [ ] **Dado** una base vacía, **cuando** se aplican las migraciones de Drizzle, **entonces** se crean todas las entidades del modelo: Cliente, Proveedor, Insumo, Producto, Receta e ítems, Compra e ítems, Lote de materia prima, Producción, Consumo, Pesada, Lote terminado, Movimiento de stock, Pedido e ítems, Ruta, Despacho e ítems, Factura y cobro, Equipo y mantenimiento, Registros BPM, Persona y tarea, Gasto fijo.
- [ ] **Dado** el esquema, **cuando** se revisan las relaciones, **entonces** coinciden con la columna "Se relaciona con" del modelo de datos (p. ej. Consumo → Lote de materia prima y Producción).
- [ ] **Dado** el stock, **cuando** se modela, **entonces** es la suma de movimientos de stock inmutables (sin columna de stock editable).
- [ ] **Dado** el seed, **cuando** se ejecuta, **entonces** carga: los 4 proveedores (Leo Pelle, Cotar, Mancinelli, Jorge), los insumos de la receta (queso barra, reggianito, manteca, fécula, huevo, leche, sal), la receta base de 75 kg de fécula con rango de leche, los productos (chipá 0,5 kg, granel 5 kg, sándwich JyQ), las 3 formas (tapitas, aritos, lengüitas), los equipos (F1 a F4, heladera, batidora, amasadora, Biscomatic, selladora), las personas y tareas del pizarrón y clientes de ejemplo.
- [ ] **Dado** el seed, **cuando** se ejecuta dos veces, **entonces** es idempotente y no duplica registros.
- [ ] **Dado** un cambio de esquema, **cuando** se genera una migración, **entonces** queda versionada en el repositorio y se aplica en CI desde cero.
- [ ] **Dado** los campos monetarios y de peso, **cuando** se definen, **entonces** usan tipos numéricos exactos (sin flotantes) y los precios se guardan netos de IVA.

**Notas técnicas**
Entidades: todas las del modelo de datos del relevamiento. Drizzle ORM sobre PostgreSQL 16. Identificador de lote terminado según regla 4 (AAMMDD + número de producción, a validar). Los datos de ejemplo se toman del relevamiento (receta del 29/09, proveedores, matriz de tareas); no se inventan clientes reales.

### P-04 · Autenticación por sesión + RBAC por roles + PIN para tablet

- **Labels:** Técnica, Plataforma · **Prioridad:** 1 (Urgent) · **Estimación:** 8 · **Padre:** ROD-234 · **Bloqueada por:** P-03 · **Bloquea:** P-05, P-10

**Historia de usuario**
Como **dirección (Nahuel)** quiero que cada persona entre con su usuario y vea solo lo que le corresponde por su rol, para proteger las finanzas y que la tablet de planta se use rápido con un PIN.

**Criterios de aceptación**

- [ ] **Dado** un usuario con email y contraseña, **cuando** inicia sesión desde PC o celular, **entonces** se crea una sesión segura (cookie httpOnly) y expira por inactividad.
- [ ] **Dado** los 7 roles del relevamiento, **cuando** se asignan a usuarios, **entonces** existen: Dirección (todo), Jefa de producción (todo menos finanzas), Logística (despacho y cobros), Operario (solo carga de su tarea), Local (ventas y stock del local), Responsable técnico (lectura y exportación de registros BPM), Contadora (lectura y exportación de compras y ventas).
- [ ] **Dado** un usuario sin permiso, **cuando** accede a una ruta o ejecuta una Server Action protegida, **entonces** el servidor la rechaza (no solo se oculta el botón).
- [ ] **Dado** la tablet de planta, **cuando** un operario toca su perfil e ingresa un PIN de 4 a 6 dígitos, **entonces** inicia sesión en menos de 5 segundos.
- [ ] **Dado** un PIN incorrecto repetido 5 veces, **cuando** se intenta de nuevo, **entonces** el perfil se bloquea temporalmente y se registra el intento.
- [ ] **Dado** el PIN, **cuando** se guarda, **entonces** se almacena con hash (nunca en texto plano) y el PIN solo habilita sesiones de rol Operario en dispositivos registrados.
- [ ] **Dado** una sesión de operario, **cuando** se inactiva N minutos (configurable), **entonces** se cierra y vuelve a la pantalla de perfiles.
- [ ] **Dado** cualquier inicio de sesión o cambio de rol, **cuando** ocurre, **entonces** queda registrado con usuario, fecha y hora.

**Notas técnicas**
Entidades: Persona y tarea (rol, habilidades), usuarios y sesiones. Permisos como matriz rol × módulo × acción en el paquete de dominio con tests unitarios. Rol Operario con acceso solo a su tarea (RF-23). Usuario de la auditoría (P-05) se toma de la sesión.

### P-05 · Auditoría por triggers (usuario, fecha/hora, historial de ediciones)

- **Labels:** Técnica, Plataforma · **Prioridad:** 1 (Urgent) · **Estimación:** 5 · **Padre:** ROD-234 · **Bloqueada por:** P-03, P-04 · **Bloquea:** (todas las historias que exigen historial de ediciones)

**Historia de usuario**
Como **responsable técnico** quiero que cada dato guarde quién y cuándo lo cargó y que cada edición conserve su historial, para tener evidencia confiable ante ASSAL.

**Criterios de aceptación**

- [ ] **Dado** cualquier tabla de negocio, **cuando** se inserta un registro, **entonces** guarda `created_by`, `created_at` automáticamente.
- [ ] **Dado** una edición o baja, **cuando** se ejecuta un UPDATE o DELETE, **entonces** un trigger de Postgres escribe en una tabla de historial el valor anterior, el nuevo, el usuario, la fecha y la hora, sin depender del código de la aplicación.
- [ ] **Dado** la sesión del usuario, **cuando** la aplicación abre una transacción, **entonces** propaga el usuario a la base (variable de sesión) para que el trigger lo registre.
- [ ] **Dado** la tabla de historial, **cuando** un usuario de la aplicación intenta modificarla o borrarla, **entonces** la base lo impide (solo inserción).
- [ ] **Dado** un registro, **cuando** se consulta su historial en la interfaz, **entonces** se ve la lista de cambios con campo, valor anterior, valor nuevo, usuario y hora.
- [ ] **Dado** una carga hecha desde la cola offline, **cuando** se sincroniza, **entonces** se conserva la hora de captura original además de la hora de sincronización.
- [ ] **Dado** una migración nueva con una tabla de negocio, **cuando** se aplica en CI, **entonces** un test verifica que la tabla tiene su trigger de auditoría.

**Notas técnicas**
Entidades: todas las de negocio más tabla de historial (`audit_log`). Triggers de Postgres con `current_setting('app.user_id')`. Requisito no funcional de auditoría del relevamiento: "cada dato guarda usuario, fecha y hora, y cada edición su historial; es clave para BPM".

### P-06 · Paquete de dominio con reglas de negocio 1–11 + tests unitarios

- **Labels:** Técnica, Plataforma · **Prioridad:** 1 (Urgent) · **Estimación:** 5 · **Padre:** ROD-234 · **Bloqueada por:** P-01 · **Bloquea:** RF-14, RF-17, RF-21, RF-25, RF-05, RF-39 (ROD-250, ROD-253, ROD-246, ROD-267, ROD-264)

**Historia de usuario**
Como **equipo de desarrollo** quiero un paquete de dominio con las reglas de negocio 1 a 11 como funciones puras y probadas, para que todos los módulos calculen igual y los números del relevamiento queden como tests.

**Criterios de aceptación**

- [ ] **Dado** el paquete `packages/domain`, **cuando** se revisa, **entonces** no depende de Next.js, React ni de la base de datos (funciones puras con tipos estrictos).
- [ ] **Regla 1:** **dado** 75 kg de fécula, **cuando** se calcula, **entonces** una receta rinde ~150 kg de producto en 2 tandas, con mínimo 75 kg y máximo 150 kg/día.
- [ ] **Regla 2:** **dado** receta por kg de fécula y kg usados, **cuando** se calcula el consumo teórico, **entonces** = cantidad por kg × kg de fécula y detecta desvío sobre un umbral configurable.
- [ ] **Regla 3:** **dado** 149,3 kg pesados (70,6 + 10,1 + 68,6) y los kg de ingredientes, **cuando** se calcula, **entonces** rendimiento = kg pesados ÷ kg de ingredientes y bolsas equivalentes = kg ÷ 0,5.
- [ ] **Regla 4:** **dado** una fecha y un número de producción, **cuando** se genera el lote, **entonces** es AAMMDD + número y el vencimiento = elaboración + 6 meses.
- [ ] **Regla 5:** **dado** varios lotes con stock, **cuando** se asigna un despacho, **entonces** se elige siempre el de vencimiento más próximo.
- [ ] **Reglas 6 y 7:** **dado** stock, consumo de 30 días, plazo de entrega y stock de seguridad, **cuando** se calcula, **entonces** cobertura = stock ÷ consumo diario promedio y punto de pedido = consumo diario × plazo + stock de seguridad.
- [ ] **Regla 8:** **dado** la receta del 29/09 (ingredientes $791.930), 149 kg reales, envase $140 y mano de obra $120.000, **cuando** se calcula, **entonces** el costo por kg es ~$5.330 y el de la bolsa se obtiene sumando el envase.
- [ ] **Regla 9:** **dado** un costo directo de $3.210 y un margen objetivo, **cuando** se calcula el precio, **entonces** = costo ÷ (1 − margen).
- [ ] **Regla 10:** **dado** stock terminado y capacidad libre diaria, **cuando** se calcula la fecha de un pedido grande, **entonces** devuelve el primer día en que ambos cubren el pedido.
- [ ] **Regla 11:** **dado** una factura con IVA 21% o 10,5%, **cuando** se procesa, **entonces** el IVA se toma de la factura y nunca se calcula a mano; cualquier otra alícuota se rechaza.
- [ ] **Dado** el paquete, **cuando** se ejecuta Vitest, **entonces** cada regla tiene tests con casos normales, bordes (división por cero, sin consumo, stock negativo) y los números del relevamiento, con cobertura de líneas del dominio >= 90%.

**Notas técnicas**
Entidades: ninguna directa (funciones puras). Las reglas 1 a 11 son la sección "Reglas de negocio y cálculos" del relevamiento. Montos con aritmética decimal exacta (sin flotantes). Los umbrales a definir (desvío de consumo) son parámetros de configuración.

### P-07 · Design system: shadcn/ui, layout responsive tablet/celular, botones grandes

- **Labels:** Técnica, Plataforma · **Prioridad:** 2 (High) · **Estimación:** 5 · **Padre:** ROD-234 · **Bloqueada por:** P-01 · **Bloquea:** P-10

**Historia de usuario**
Como **operario** quiero pantallas con botones grandes y pocos pasos, para cargar registros con guantes y en menos de 30 segundos.

**Criterios de aceptación**

- [ ] **Dado** Tailwind 4 y shadcn/ui, **cuando** se configura el sistema de diseño, **entonces** hay tokens de color, tipografía y espaciado, y componentes base (botón, campo, tabla, diálogo, selector, tarjeta).
- [ ] **Dado** el modo "planta", **cuando** se usa en tablet, **entonces** los objetivos táctiles miden al menos 56 px y hay una variante de teclado numérico grande para cantidades y PIN.
- [ ] **Dado** el layout, **cuando** se abre en celular (360 px), tablet (768 a 1024 px) y PC, **entonces** se adapta sin scroll horizontal.
- [ ] **Dado** cualquier formulario, **cuando** se muestra, **entonces** los textos, fechas (dd/mm/aaaa) y montos ($ con separador argentino) están en español de Argentina.
- [ ] **Dado** los estados de carga, error y sin conexión, **cuando** ocurren, **entonces** hay componentes consistentes y mensajes claros sin tecnicismos.
- [ ] **Dado** los componentes, **cuando** se revisan con una auditoría de accesibilidad (axe), **entonces** no hay violaciones críticas y el contraste cumple WCAG AA.
- [ ] **Dado** una pantalla de planta típica (cargar un consumo), **cuando** se mide, **entonces** se completa en 3 pantallas o menos.

**Notas técnicas**
Entidades: ninguna. Tailwind 4 + shadcn/ui, Storybook o página de catálogo interna opcional. Requisito no funcional: tablet con botones grandes, usable con guantes, pocas pantallas.

### P-08 · Testing: Vitest + Playwright E2E + datos de prueba

- **Labels:** Técnica, Plataforma · **Prioridad:** 2 (High) · **Estimación:** 5 · **Padre:** ROD-234 · **Bloqueada por:** P-01, P-03 · **Bloquea:** P-09

**Historia de usuario**
Como **equipo de desarrollo** quiero la infraestructura de pruebas unitarias, de integración y E2E con datos de prueba, para cumplir el Definition of Done en cada historia.

**Criterios de aceptación**

- [ ] **Dado** el monorepo, **cuando** se ejecuta `pnpm test`, **entonces** Vitest corre los tests unitarios del dominio y de integración de la base.
- [ ] **Dado** los tests de integración, **cuando** corren, **entonces** usan una base Postgres 16 efímera (contenedor) con migraciones aplicadas y se limpia entre tests.
- [ ] **Dado** Playwright, **cuando** se ejecuta `pnpm e2e`, **entonces** levanta la app contra una base de prueba con el seed y corre en Chromium con viewport de tablet y de celular.
- [ ] **Dado** el flujo de ejemplo "iniciar sesión con PIN y abrir la pantalla del operario", **cuando** se ejecuta, **entonces** hay un test E2E de referencia que sirve de plantilla para las demás historias.
- [ ] **Dado** una fábrica de datos de prueba (factories), **cuando** un test las usa, **entonces** crea clientes, insumos, lotes y producciones válidos sin repetir código.
- [ ] **Dado** una falla de E2E, **cuando** ocurre en CI, **entonces** se guardan trazas, capturas y video como artefactos.
- [ ] **Dado** los tests de reglas de negocio (P-06), **cuando** se agrega una regla nueva, **entonces** la plantilla de tests exige casos de borde.

**Notas técnicas**
Entidades: todas (datos de prueba). Vitest + Playwright. Los datos de prueba son distintos del seed de desarrollo y no incluyen datos personales reales.

### P-09 · CI GitHub Actions (lint, typecheck, unit, e2e)

- **Labels:** Técnica, Plataforma · **Prioridad:** 2 (High) · **Estimación:** 3 · **Padre:** ROD-234 · **Bloqueada por:** P-08 · **Bloquea:** ninguna

**Historia de usuario**
Como **equipo de desarrollo** quiero un pipeline de CI en GitHub Actions, para que ningún cambio se integre sin lint, tipos, tests unitarios y E2E en verde.

**Criterios de aceptación**

- [ ] **Dado** un pull request, **cuando** se abre o actualiza, **entonces** corre lint, typecheck, tests unitarios, migraciones desde cero y E2E.
- [ ] **Dado** cualquier etapa en rojo, **cuando** finaliza, **entonces** el PR no se puede mergear (rama `main` protegida con checks requeridos).
- [ ] **Dado** el pipeline, **cuando** corre repetidamente, **entonces** usa caché de pnpm y de Turborepo y tarda menos de 10 minutos en total.
- [ ] **Dado** una falla de E2E, **cuando** ocurre, **entonces** se suben trazas y capturas como artefactos del job.
- [ ] **Dado** el repositorio, **cuando** se revisan los workflows, **entonces** no hay secretos en texto plano; los secretos usan GitHub Secrets.
- [ ] **Dado** un cambio solo de documentación, **cuando** se abre el PR, **entonces** el pipeline omite el E2E.

**Notas técnicas**
Entidades: ninguna. GitHub Actions con servicio Postgres 16. El estado del CI verde forma parte del Definition of Done.

### P-10 · PWA instalable + cola offline para registros de planta

- **Labels:** Técnica, Plataforma · **Prioridad:** 2 (High) · **Estimación:** 8 · **Padre:** ROD-234 · **Bloqueada por:** P-04, P-07 · **Bloquea:** RF-20, RF-15, RF-11, RF-34 (ROD-245, ROD-251, ROD-258, ROD-277)

**Historia de usuario**
Como **operario** quiero que la app se instale en la tablet y guarde mis registros aunque se corte la señal, para no perder datos y sincronizarlos cuando vuelva la conexión.

**Criterios de aceptación**

- [ ] **Dado** la app en Chrome de la tablet y del celular, **cuando** se visita, **entonces** se puede instalar como PWA con ícono, nombre y pantalla completa.
- [ ] **Dado** una pantalla de carga de planta, **cuando** se pierde la señal, **entonces** el registro se guarda localmente (IndexedDB) y se muestra un indicador claro de "pendiente de sincronizar".
- [ ] **Dado** registros pendientes, **cuando** vuelve la conexión, **entonces** se envían en orden y cada uno se confirma; los fallidos quedan visibles para reintento.
- [ ] **Dado** un registro creado offline, **cuando** se sincroniza, **entonces** conserva la fecha y hora de captura del dispositivo y el servidor la valida contra la hora del servidor.
- [ ] **Dado** un envío repetido (reintento), **cuando** llega al servidor, **entonces** no duplica el registro (idempotencia por clave de operación).
- [ ] **Dado** que se pierde la señal, **cuando** el operario abre las pantallas de carga ya visitadas, **entonces** cargan desde caché sin errores.
- [ ] **Dado** la prueba E2E de referencia, **cuando** se simula modo sin conexión, **entonces** el registro se guarda, se reconecta y aparece una sola vez en la base.
- [ ] **Dado** un conflicto (el dato fue editado en el servidor), **cuando** se sincroniza, **entonces** no se pisa silenciosamente: se marca para revisión.

**Notas técnicas**
Entidades: todas las de carga de planta (Producción, Consumo, Pesada, Registros BPM, Lote de materia prima). Service worker, IndexedDB, claves de idempotencia. Requisito no funcional: "si se corta la señal, guarda y sincroniza después". Pendiente de relevar: wifi estable en planta.

### P-11 · Backup diario automático + exportación Excel/PDF

- **Labels:** Técnica, Plataforma · **Prioridad:** 2 (High) · **Estimación:** 5 · **Padre:** ROD-234 · **Bloqueada por:** P-03 · **Bloquea:** ninguna

**Historia de usuario**
Como **dirección (Nahuel)** quiero un backup diario automático en la nube y poder exportar los datos a Excel y PDF, para no volver a depender de un archivo sin respaldo como el GASTOS general.ods.

**Criterios de aceptación**

- [ ] **Dado** la base de producción, **cuando** pasa la hora programada (una vez por día), **entonces** se genera un backup completo y se guarda en almacenamiento en la nube separado de la base.
- [ ] **Dado** los backups, **cuando** se aplica la política de retención, **entonces** se conservan al menos 30 diarios y los más viejos se eliminan automáticamente.
- [ ] **Dado** un backup, **cuando** se prueba la restauración en una base vacía, **entonces** el sistema vuelve a funcionar y hay un procedimiento escrito y probado.
- [ ] **Dado** una falla del backup, **cuando** ocurre, **entonces** se notifica a Dirección y al equipo.
- [ ] **Dado** cualquier listado de la app, **cuando** se pide exportar, **entonces** se genera un Excel (xlsx) con los mismos filtros y columnas visibles.
- [ ] **Dado** una ficha o planilla, **cuando** se pide exportar, **entonces** se genera un PDF con formato de impresión A4.
- [ ] **Dado** una exportación, **cuando** se completa, **entonces** queda registrado quién y cuándo la hizo, y respeta el rol (la Contadora y el Responsable técnico exportan solo lo permitido).

**Notas técnicas**
Entidades: todas. Backup: `pg_dump` programado o backups gestionados de Supabase más copia propia a S3. Librerías de exportación (xlsx y PDF) compartidas por M2, M6, M7 y M8. Costo de operación objetivo: decenas de dólares por mes.

### P-12 · Dockerfile de producción y guía de despliegue (Supabase + Vercel)

- **Labels:** Técnica, Plataforma · **Prioridad:** 2 (High) · **Estimación:** 3 · **Padre:** ROD-234 · **Bloqueada por:** P-01, P-02 · **Bloquea:** ninguna

**Historia de usuario**
Como **equipo de desarrollo** quiero un Dockerfile de producción y una guía de despliegue, para publicar la app en Vercel con base y archivos en Supabase y poder replicarla en un servidor propio si hace falta.

**Criterios de aceptación**

- [ ] **Dado** el repositorio, **cuando** se construye la imagen con el Dockerfile multi-stage, **entonces** genera una imagen de la app Next.js que arranca y responde en `/api/health` con estado OK.
- [ ] **Dado** la imagen, **cuando** se inspecciona, **entonces** corre con un usuario no root, no contiene secretos y pesa menos de 400 MB.
- [ ] **Dado** la guía de despliegue, **cuando** se sigue paso a paso, **entonces** permite publicar en Vercel con Supabase (Postgres y Storage) incluyendo variables de entorno, migraciones y dominio.
- [ ] **Dado** una versión nueva, **cuando** se despliega, **entonces** las migraciones se aplican antes de servir tráfico y hay un procedimiento de rollback documentado.
- [ ] **Dado** la guía, **cuando** se revisa, **entonces** incluye la lista de variables de entorno, el costo mensual estimado de infraestructura y los pasos para configurar el backup (P-11).
- [ ] **Dado** el entorno de producción, **cuando** la app se abre, **entonces** funciona en HTTPS y la PWA es instalable.

**Notas técnicas**
Entidades: ninguna. Arquitectura: Next.js en Vercel, Postgres y Storage en Supabase, Docker Compose solo para desarrollo local y alternativa autoalojada. Costo de operación esperado: decenas de dólares por mes.

---

### Spikes de Fase 1: ordenar (no es software)

Condición para avanzar a la Fase 2: resultado mensual cerrado y receta validada. Estos issues no tienen épica padre.

### F1-01 · Spike: Bajar "Mis Comprobantes" de ARCA (12 meses) y armar el resultado mensual real

- **Labels:** Spike · **Prioridad:** 2 (High) · **Estimación:** 5 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-40 (ROD-pendiente)

**Historia de usuario**
Como **dirección (Nahuel)** quiero bajar 12 meses de "Mis Comprobantes" de ARCA (emitidas y recibidas) y armar el resultado mensual real, para saber si el negocio gana lo que creen los socios (~$9M de retiros contra ~$2,9M estimados).

**Criterios de aceptación**

- [ ] **Dado** el acceso a ARCA, **cuando** se descargan los comprobantes, **entonces** hay 12 meses de facturas emitidas y 12 meses de recibidas en archivos guardados con backup.
- [ ] **Dado** los comprobantes, **cuando** se arma la planilla de resultado mensual, **entonces** muestra por mes: ventas, compras de insumos, gastos fijos y resultado antes de reparto, local, impuestos y retiros.
- [ ] **Dado** la planilla, **cuando** se la compara con el estimado del relevamiento (ventas ~$18,9M, ingredientes y envase ~$12,35M, mano de obra ~$2,64M, fijos ~$1,04M), **entonces** se documentan las diferencias y su explicación (más volumen, costo real menor o ganancia menor a la percibida).
- [ ] **Dado** que falta la nómina con cargas sociales o el costo del vehículo, **cuando** se arma el resultado, **entonces** se marca como parcial y se listan las partidas faltantes.
- [ ] **Dado** el resultado cerrado, **cuando** se presenta a Dirección, **entonces** queda aprobado como la condición de avance de la Fase 1.

**Notas técnicas**
No es software. Entregable: planilla con backup. Su estructura define los cálculos de RF-40. Datos pendientes relacionados: "Mis Comprobantes" de los últimos 12 meses, nómina, retiros mensuales de los socios.

### F1-02 · Spike: Validar la receta en planta pesando 3 producciones; ficha plastificada y kits de pesado

- **Labels:** Spike · **Prioridad:** 2 (High) · **Estimación:** 3 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-18 (ROD-243)

**Historia de usuario**
Como **jefa de producción** quiero validar en planta la receta real pesando 3 producciones y dejar una ficha plastificada y kits de pesado por tanda, para que la dosificación no dependa de la memoria de una sola persona.

**Criterios de aceptación**

- [ ] **Dado** 3 producciones consecutivas, **cuando** se pesan todos los insumos y el producto final, **entonces** se registran cantidades reales de queso barra, reggianito, manteca, fécula, huevo, leche y sal, y kg pesados por forma.
- [ ] **Dado** los datos, **cuando** se calculan, **entonces** se obtiene el rendimiento real (kg pesados ÷ kg de ingredientes) y se compara con ~149 kg del registro del 01/09 y con los 163,5 kg del Excel.
- [ ] **Dado** la variación de leche (18 a 28 L por 75 kg de fécula), **cuando** se analiza, **entonces** se define y escribe el criterio y el rango aceptable (dato pendiente del relevamiento).
- [ ] **Dado** la receta validada, **cuando** se imprime, **entonces** hay una ficha plastificada en planta con cantidades por tanda y rangos.
- [ ] **Dado** los kits de pesado, **cuando** se preparan, **entonces** hay un kit por tanda con los insumos de leche, sal y demás pesados de antemano.
- [ ] **Dado** el cierre del spike, **cuando** se revisa, **entonces** la jefa de producción y Dirección firman la receta validada (condición de avance de la Fase 1).

**Notas técnicas**
No es software. La receta validada es el dato inicial de la receta maestra (RF-18) y confirma el supuesto de que una tanda de 75 kg de fécula rinde ~150 kg.

### F1-03 · Spike: Matriz de polivalencia y entrenamiento de un reemplazo para leche, sal y batidora

- **Labels:** Spike · **Prioridad:** 2 (High) · **Estimación:** 3 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-23 (ROD-248)

**Historia de usuario**
Como **dirección (Nahuel)** quiero una matriz de polivalencia y un reemplazo entrenado para leche, sal y batidora, para que la planta no se desordene si falta A.F.

**Criterios de aceptación**

- [ ] **Dado** la matriz de tareas del pizarrón, **cuando** se completa, **entonces** muestra por persona qué tareas sabe hacer y quién reemplaza a quién.
- [ ] **Dado** los puestos críticos sin reemplazo (A.F. en leche, sal y batidora; E.A. en amasadora y Biscomatic; J.T. en reggianito y acopio), **cuando** se analiza, **entonces** cada uno queda con un reemplazo propuesto.
- [ ] **Dado** el reemplazo para leche, sal y batidora, **cuando** se entrena, **entonces** realiza al menos 3 producciones supervisadas siguiendo la ficha de receta.
- [ ] **Dado** el entrenamiento, **cuando** termina, **entonces** queda registrado con fecha, persona entrenada y quién valida.
- [ ] **Dado** el supuesto "A.F. es la madre", **cuando** se valida con Dirección, **entonces** queda confirmado o corregido.

**Notas técnicas**
No es software. Alimenta la matriz de polivalencia digital de RF-23 (Persona y tarea). Riesgo de adopción: empezar por lo que le saca trabajo a la jefa de producción.

### F1-04 · Spike: WhatsApp Business de la empresa y planilla de pedidos con estados

- **Labels:** Spike · **Prioridad:** 3 (Medium) · **Estimación:** 2 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-02, RF-06 (ROD-261, ROD-265)

**Historia de usuario**
Como **jefa de producción** quiero un WhatsApp Business de la empresa y una planilla de pedidos con estados, para dejar de recibir pedidos en el WhatsApp personal y en el cuaderno.

**Criterios de aceptación**

- [ ] **Dado** un número de la empresa, **cuando** se registra WhatsApp Business, **entonces** queda con nombre, descripción y horario de atención.
- [ ] **Dado** los clientes actuales, **cuando** se les comunica el nuevo número, **entonces** al menos los 10 principales confirman que pedirán por ahí.
- [ ] **Dado** la planilla de pedidos, **cuando** se crea, **entonces** tiene cliente, productos, cantidad, fecha comprometida y estado (recibido, confirmado, en producción, listo, despachado, entregado, facturado, cobrado).
- [ ] **Dado** una semana de uso, **cuando** se revisa, **entonces** todo pedido está en la planilla y ninguno quedó solo en el WhatsApp personal.
- [ ] **Dado** el mes completo del cuaderno de pedidos (dato pendiente), **cuando** se entrega, **entonces** se digitaliza en la planilla para ver historial.

**Notas técnicas**
No es software. La planilla anticipa el modelo de Pedido (RF-02, RF-03). El WhatsApp Business es la base de RF-06 en Fase 3.

### F1-05 · Spike: Planilla de compras con IVA automático y conteo semanal de materia prima

- **Labels:** Spike · **Prioridad:** 3 (Medium) · **Estimación:** 3 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-13, RF-15 (ROD-249, ROD-251)

**Historia de usuario**
Como **dirección (Nahuel)** quiero una planilla de compras con el IVA calculado automáticamente y un conteo semanal de materia prima, para tener datos de gasto y stock mientras se construye el sistema.

**Criterios de aceptación**

- [ ] **Dado** la pestaña Insumos actual, **cuando** se rediseña la planilla, **entonces** tiene insumo, proveedor, fecha, número de factura, cantidad, precio neto, alícuota (21% o 10,5%), IVA y total, con IVA calculado por fórmula.
- [ ] **Dado** una compra cargada, **cuando** se completa, **entonces** el total del mes por proveedor y por insumo se calcula solo.
- [ ] **Dado** el conteo semanal, **cuando** se hace cada semana, **entonces** se registra por insumo la cantidad, la fecha y quién contó.
- [ ] **Dado** 4 semanas de conteo, **cuando** se revisan, **entonces** se puede estimar el consumo diario por insumo y la cobertura en días.
- [ ] **Dado** el plazo de entrega de cada proveedor (dato pendiente), **cuando** se relevan, **entonces** quedan anotados en la planilla.

**Notas técnicas**
No es software. Los plazos de entrega y el consumo estimado alimentan el punto de pedido (reglas 6 y 7) y el seed del sistema.

### F1-06 · Spike: Fijar días de reparto por zona y medir km y horas durante 2 semanas

- **Labels:** Spike · **Prioridad:** 3 (Medium) · **Estimación:** 3 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-24, RF-26, RF-27 (ROD-266, ROD-268, ROD-269)

**Historia de usuario**
Como **logística (el chofer)** quiero días de reparto fijos por zona y medir km y horas durante 2 semanas, para conocer el costo real del reparto y evitar rutas chicas.

**Criterios de aceptación**

- [ ] **Dado** las zonas de reparto (Rosario, Funes, Pueblo Esther y las que correspondan), **cuando** se definen, **entonces** cada una tiene un día fijo de entrega y se comunica a los clientes.
- [ ] **Dado** 2 semanas de rutas, **cuando** se registran, **entonces** cada salida tiene km inicial y final, hora de salida y regreso, combustible y kg entregados.
- [ ] **Dado** los datos, **cuando** se analizan, **entonces** se calcula costo por ruta y por kg entregado y se identifican las rutas que pierden plata (como la del 30/09 con 25 kg).
- [ ] **Dado** el análisis, **cuando** se presenta, **entonces** se propone un pedido mínimo por zona o por ruta.
- [ ] **Dado** los costos del vehículo (combustible, seguro, mantenimiento, patente; dato pendiente), **cuando** se obtienen, **entonces** se incorporan al análisis.

**Notas técnicas**
No es software. Los datos validan RF-24 a RF-27 y el costo de reparto del resultado mensual. Pendiente de relevar: registro de temperaturas y hoja de reparto de una semana.

### F1-07 · Spike: Copiar GASTOS general.ods y dejarlo con backup

- **Labels:** Spike · **Prioridad:** 3 (Medium) · **Estimación:** 1 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-42 (pendiente)

**Historia de usuario**
Como **dirección (Nahuel)** quiero copiar el archivo GASTOS general.ods completo y dejarlo con backup, para no perder 47 pestañas de historia de costos y tener los datos reales (no fotos del monitor).

**Criterios de aceptación**

- [ ] **Dado** el archivo en la PC, **cuando** se copia a un pendrive, **entonces** se obtiene el archivo completo con las 47 pestañas.
- [ ] **Dado** la copia, **cuando** se sube a la nube, **entonces** hay al menos dos copias en lugares distintos.
- [ ] **Dado** el backup, **cuando** se programa, **entonces** se repite automáticamente (semanal como mínimo) mientras el archivo siga en uso.
- [ ] **Dado** el archivo copiado, **cuando** se abre en otra máquina, **entonces** se verifica que abre y conserva las fórmulas.
- [ ] **Dado** el archivo, **cuando** se entrega al equipo, **entonces** queda como insumo para el seed de gastos fijos y el análisis de costeo.

**Notas técnicas**
No es software. Resuelve el riesgo "estructura frágil sin backup" (error 10 del análisis del Excel). Cubre el primer ítem de "Datos a conseguir".

### F1-08 · Spike: Datos a conseguir y supuestos a confirmar

- **Labels:** Spike · **Prioridad:** 2 (High) · **Estimación:** 5 · **Padre:** ninguno · **Bloqueada por:** ninguna · **Bloquea:** RF-18, RF-22, RF-14, RF-29, RF-40 (ROD-243, ROD-247, ROD-250)

**Historia de usuario**
Como **Product Owner** quiero cerrar los datos y supuestos pendientes del relevamiento, para que cambien el alcance y el diagnóstico económico antes de cerrar la propuesta del sistema.

**Datos a conseguir**

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

**Supuestos a confirmar**

- [ ] A.F. es la madre y N.R. es quien supervisa los registros (¿Nahuel o el responsable técnico?)
- [ ] La "tanda" de 75 kg es de producto amasado y una receta de 75 kg de fécula rinde ~150 kg
- [ ] Criterio de la leche: ¿se ajusta por textura? ¿Cuál es el rango aceptable?
- [ ] Identificador de lote de producto terminado: fecha de vencimiento o número 1210–1220
- [ ] Significado de los códigos del pizarrón (SW, C500, SWG, C granel) y lista completa de productos
- [ ] Qué parte de la venta se factura
- [ ] Stock y ventas del local: quién lo abastece y con qué frecuencia
- [ ] Plazo de entrega de cada proveedor
- [ ] Quién va a usar la tablet en planta y si hay wifi estable

**Criterios de aceptación**

- [ ] **Dado** cada dato de la lista, **cuando** se obtiene, **entonces** se guarda en una carpeta compartida con fecha y fuente, y se tilda en esta lista.
- [ ] **Dado** cada supuesto, **cuando** se confirma o se corrige con la persona responsable, **entonces** se anota la respuesta y quién la dio, y se actualiza el relevamiento.
- [ ] **Dado** una respuesta que cambia el alcance (p. ej. identificador de lote, códigos del pizarrón, qué parte se factura), **cuando** ocurre, **entonces** se abre o ajusta la historia afectada (RF-22, RF-16, RF-30, RF-32).
- [ ] **Dado** el cierre del spike, **cuando** se revisa, **entonces** quedan registrados los datos que no se pudieron conseguir y su impacto en los cálculos.

**Notas técnicas**
No es software. Es la lista completa de "Datos a conseguir" y "Supuestos a confirmar" de la sección "Pendientes y supuestos a validar" del relevamiento. Referencias: regla 4 (lote), RF-16 (códigos del pizarrón), RF-29 (precios por canal), RF-39/RF-40 (costos).

---

## Milestone: Sprint 6 — BPM y mantenimiento (M7)

### RF-37 · Equipos con plan preventivo y órdenes correctivas

- **Labels:** Historia, M7 BPM · **Prioridad:** 3 (Medium) · **Estimación:** 5 · **Padre:** ROD-241 · **Bloqueada por:** ninguna (usa equipos del seed P-03) · **Bloquea:** ninguna

**Historia de usuario**
Como **jefa de producción** quiero tener los equipos con un plan preventivo (frecuencia y tareas), avisos de vencimiento y órdenes correctivas con causa, repuesto y costo, para evitar las paradas repetidas de la Biscomatic y los riesgos en el frío.

**Criterios de aceptación**

- [ ] **Dado** un equipo (batidora, amasadora, Biscomatic, F1 a F4, heladera, selladora, balanza, rallador, vehículo), **cuando** se define un plan preventivo, **entonces** guarda tareas y frecuencia (días o semanas) y calcula la próxima fecha.
- [ ] **Dado** una tarea preventiva con vencimiento próximo o vencido, **cuando** pasa el plazo, **entonces** se muestra un aviso y aparece en la pantalla principal.
- [ ] **Dado** una intervención preventiva realizada, **cuando** se registra (fecha, responsable, supervisor, actividad), **entonces** se reprograma la próxima y se mantiene el historial.
- [ ] **Dado** una falla, **cuando** se abre una orden correctiva, **entonces** guarda equipo, causa, repuesto, costo, fecha y responsable.
- [ ] **Dado** un equipo con correctivos repetidos (como el cambio de alambre de la Biscomatic), **cuando** se consulta su historial, **entonces** se destacan las recurrencias.
- [ ] **Dado** el indicador "Preventivos cumplidos", **cuando** se calcula, **entonces** = hechos ÷ programados por mes.
- [ ] **Dado** el historial de trabajos desde 2023, **cuando** se migra, **entonces** se puede cargar como histórico (opcional).

**Notas técnicas**
Entidades: Equipo y mantenimiento (equipo, frecuencia, tarea, tipo, fecha, costo), Persona, Gasto fijo/costos. Reemplaza el registro "Trabajos de mantenimiento" respetando sus campos (área, equipo, preventivo/correctivo, actividad, fecha, responsable, supervisor). Las frecuencias por equipo las define el responsable técnico (el relevamiento no las fija).

### RF-38 · Alerta de temperatura fuera de rango

- **Labels:** Historia, M7 BPM · **Prioridad:** 3 (Medium) · **Estimación:** 3 · **Padre:** ROD-241 · **Bloqueada por:** RF-34 (ROD-277) · **Bloquea:** RF-38b

**Historia de usuario**
Como **jefa de producción** quiero recibir una alerta cuando una temperatura cargada está fuera de rango, para reaccionar ante fallas o cortes de luz en el abatidor y los freezers, que hoy no tienen alarma.

**Criterios de aceptación**

- [ ] **Dado** un rango aceptable por equipo (F1 a F4, heladera, vehículo; −20 °C de referencia en el reparto), **cuando** se carga una lectura fuera de rango, **entonces** se genera una alerta visible en la pantalla principal y queda registrada.
- [ ] **Dado** una alerta de temperatura, **cuando** se atiende, **entonces** se registra la acción tomada, con usuario y hora, y se puede cerrar.
- [ ] **Dado** una lectura fuera de rango en un equipo con producto almacenado, **cuando** se genera la alerta, **entonces** se listan los lotes ubicados en ese equipo (RF-16) para decidir.
- [ ] **Dado** que no se cargó ninguna lectura esperada en el horario definido, **cuando** pasa el horario, **entonces** se alerta por lectura faltante.
- [ ] **Dado** la alerta, **cuando** se genera, **entonces** se envía una notificación a los roles configurados (jefa de producción y dirección).
- [ ] **Dado** el alcance de esta historia, **cuando** se evalúa, **entonces** cubre las lecturas cargadas por personas; los sensores automáticos son una historia de Fase 3.

**Notas técnicas**
Entidades: Registros BPM (temperatura), Equipo, Lote terminado (ubicación). Los rangos por equipo se confirman con el responsable técnico. Los sensores con alarma en los freezers son Fase 3 (historia RF-38b).

---

## Milestone: Sprint 7 — Tablero y costeo (M8)

### RF-39 · Costo por kg y por bolsa actualizado solo

- **Labels:** Historia, M8 Tablero · **Prioridad:** 3 (Medium) · **Estimación:** 5 · **Padre:** ROD-242 · **Bloqueada por:** ROD-243 (RF-18), ROD-256 (RF-09) · **Bloquea:** RF-29 (ROD-271), RF-40

**Historia de usuario**
Como **dirección (Nahuel)** quiero ver el costo por kg y por bolsa actualizado solo, con el último precio de compra y el rendimiento real, para fijar precios con el costo al día y no con un Excel desactualizado.

**Criterios de aceptación**

- [ ] **Dado** la receta vigente, los últimos precios de compra sin IVA y el rendimiento real, **cuando** se calcula, **entonces** costo por kg = suma(cantidad de insumo × último precio sin IVA) ÷ kg reales producidos + mano de obra ÷ kg (regla 8).
- [ ] **Dado** el costo por kg, **cuando** se calcula el de la bolsa de 0,5 kg, **entonces** se suma el envase (bolsa + etiqueta) (regla 8).
- [ ] **Dado** los datos del relevamiento (ingredientes $791.930, 149 kg reales, envase $140, mano de obra $120.000), **cuando** se usan como caso de prueba, **entonces** el costo por kg es ~$5.330 (no ~$4.844 como en el Excel) y se documenta la diferencia.
- [ ] **Dado** una nueva compra confirmada (RF-09) o una nueva producción con rendimiento (RF-21), **cuando** se guardan, **entonces** el costo se recalcula automáticamente.
- [ ] **Dado** el costo calculado, **cuando** se consulta, **entonces** se muestra el desglose por insumo y su % del costo total (lácteos ~76% de los ingredientes en el relevamiento).
- [ ] **Dado** que falta el precio de un insumo o el rendimiento real, **cuando** se calcula, **entonces** se indica el dato faltante en lugar de asumir un valor.
- [ ] **Dado** el costeo del sándwich de chipá (JyQ), **cuando** se calcula, **entonces** incluye masa, jamón y queso (en el Excel actual estaban en $0).

**Notas técnicas**
Entidades: Receta e ítems, Compra e ítems (último precio), Producción (rendimiento), Gasto fijo, Producto. Regla 8 en el paquete de dominio con tests unitarios. Corrige los errores 1, 2, 3, 5 y 8 del análisis del Excel. Depende de RF-18 y RF-09. La mano de obra requiere el costo real de la nómina (dato pendiente).

### RF-40 · Resultado mensual real

- **Labels:** Historia, M8 Tablero · **Prioridad:** 3 (Medium) · **Estimación:** 8 · **Padre:** ROD-242 · **Bloqueada por:** RF-39, RF-42 · **Bloquea:** ninguna

**Historia de usuario**
Como **dirección (Nahuel)** quiero un resultado mensual con ventas por canal, costo de ventas, mano de obra, fijos, reparto y resultado, para saber si el negocio gana y cuánto puede retirarse cada socio.

**Criterios de aceptación**

- [ ] **Dado** un mes, **cuando** se consulta, **entonces** muestra ventas por canal (supermercados, revendedores, local), costo de ventas, mano de obra, gastos fijos, costo de reparto y resultado.
- [ ] **Dado** pedidos entregados y facturas, **cuando** se calculan las ventas, **entonces** se toman de datos del sistema y no de proyecciones a un precio fijo.
- [ ] **Dado** los gastos fijos cargados (RF-42), **cuando** se calcula el resultado, **entonces** se restan completos y el resultado = ventas − costo de ventas − mano de obra − fijos − reparto.
- [ ] **Dado** una venta de 891 bolsas (3 producciones) y el costo de las mismas 3 producciones, **cuando** se calcula, **entonces** costo y venta se comparan sobre el mismo volumen (corrige el error de la ganancia del Excel que daba −$9.793.384).
- [ ] **Dado** el resultado mensual, **cuando** se exporta, **entonces** se descarga en Excel y PDF.
- [ ] **Dado** que faltan datos (p. ej. nómina o costos de vehículo), **cuando** se calcula, **entonces** se marca "resultado parcial" y se listan las partidas faltantes.
- [ ] **Dado** el rol Jefa de producción, **cuando** accede, **entonces** no ve el resultado financiero.

**Notas técnicas**
Entidades: Pedido, Factura y cobro, Compra, Producción, Gasto fijo, Ruta. Primer entregable del proyecto según el relevamiento: un resultado mensual real que valide la ganancia percibida (~$9M retiros) contra la estimada (~$2,9M). Acceso solo dirección y contadora (lectura).

### RF-41 · Indicadores del tablero

- **Labels:** Historia, M8 Tablero · **Prioridad:** 3 (Medium) · **Estimación:** 5 · **Padre:** ROD-242 · **Bloqueada por:** RF-40 · **Bloquea:** ninguna

**Historia de usuario**
Como **dirección (Nahuel)** quiero un tablero con los indicadores del plan de implementación, para ver de un vistazo la capacidad, los márgenes, la deuda, el stock y el cumplimiento de BPM.

**Criterios de aceptación**

- [ ] **Dado** el tablero, **cuando** se abre, **entonces** muestra los 12 indicadores: uso de capacidad (kg ÷ 150), rendimiento, costo por bolsa, margen por canal, ventas por canal y cliente, entregas a tiempo y completas, cobertura de materia prima, deuda de clientes, costo de reparto por kg, tiempo de trazabilidad, registros BPM al día y preventivos cumplidos.
- [ ] **Dado** cada indicador, **cuando** se muestra, **entonces** indica su fórmula, frecuencia (diaria, semanal, mensual, trimestral) y meta inicial.
- [ ] **Dado** el uso de capacidad semanal, **cuando** se calcula, **entonces** = kg producidos ÷ 150 por día de producción, mostrando la base (~67%) como referencia.
- [ ] **Dado** una cobertura bajo el punto de pedido, **cuando** se calcula, **entonces** el indicador "Ningún insumo bajo el punto de pedido" muestra los insumos incumplidos.
- [ ] **Dado** un indicador sin datos suficientes, **cuando** se muestra, **entonces** dice "medir base" en lugar de un cero.
- [ ] **Dado** el tablero en celular, **cuando** se abre, **entonces** es legible sin scroll horizontal.
- [ ] **Dado** el rol sin acceso financiero, **cuando** abre el tablero, **entonces** no ve los indicadores financieros.

**Notas técnicas**
Entidades: todas las de los módulos M1 a M7 (lee de todos). Consultas/vistas materializadas por indicador. Indicadores y metas tomados de la tabla "Indicadores" del relevamiento.

### RF-42 · Carga mensual de gastos fijos y servicios

- **Labels:** Historia, M8 Tablero · **Prioridad:** 3 (Medium) · **Estimación:** 2 · **Padre:** ROD-242 · **Bloqueada por:** ninguna · **Bloquea:** RF-40

**Historia de usuario**
Como **dirección (Nahuel)** quiero cargar cada mes los gastos fijos y servicios, para que el resultado mensual los incluya completos.

**Criterios de aceptación**

- [ ] **Dado** un mes, **cuando** se cargan gastos fijos (concepto, mes, importe), **entonces** se guardan y se pueden copiar del mes anterior para editarlos.
- [ ] **Dado** los conceptos del Excel de abril (alquiler, contadora, luz, ASSAL, seguro, agua, desinfección), **cuando** se hace el seed, **entonces** vienen precargados como conceptos.
- [ ] **Dado** los conceptos faltantes detectados (vehículo, combustible, sueldos del local, impuestos, amortizaciones), **cuando** se crea el catálogo de conceptos, **entonces** están disponibles para cargar.
- [ ] **Dado** un mes sin gastos fijos cargados, **cuando** se consulta el resultado, **entonces** se avisa "gastos fijos pendientes".
- [ ] **Dado** una edición de un gasto de un mes cerrado, **cuando** se guarda, **entonces** queda historial con usuario y hora.
- [ ] **Dado** la carga, **cuando** se exporta, **entonces** se obtiene en Excel.

**Notas técnicas**
Entidades: Gasto fijo (concepto, mes, importe). Reemplaza las pestañas de servicios y gastos del GASTOS general.ods (47 pestañas, sin backup). Solo accesible para dirección.

---

## Milestone: Fase 3 — Crecer (backlog)

Todos con label **Fase 3** y prioridad 4 (Low). Condición de entrada: Fase 2 cumplida (un mes completo sin planillas en papel y simulacro de trazabilidad en menos de 1 minuto).

### RF-38b · Sensores de temperatura con alarma en freezers (Fase 3)

- **Labels:** Historia, M7 BPM, Fase 3 · **Prioridad:** 4 (Low) · **Estimación:** 8 · **Padre:** ROD-241 · **Bloqueada por:** RF-38

**Historia de usuario**
Como **jefa de producción** quiero sensores de temperatura con alarma en los freezers, para enterarme de un corte de luz o falla del abatidor sin depender de que alguien cargue la lectura (**Fase 3**, parte de sensores de RF-38).

**Criterios de aceptación**

- [ ] **Dado** un sensor instalado en F1, F2, F3, F4 o heladera, **cuando** envía una lectura, **entonces** se guarda como registro BPM de temperatura con el equipo y la hora de captura.
- [ ] **Dado** una lectura fuera de rango, **cuando** llega, **entonces** se dispara la misma alerta que RF-38 y se notifica de inmediato.
- [ ] **Dado** que un sensor deja de reportar durante el tiempo configurado, **cuando** ocurre, **entonces** se alerta por sensor sin señal.
- [ ] **Dado** el historial de temperaturas, **cuando** se exporta a PDF (RF-36), **entonces** incluye las lecturas automáticas diferenciadas de las manuales.
- [ ] **Dado** un corte de luz, **cuando** se recupera el servicio, **entonces** se puede ver la duración de la desviación por equipo.

**Notas técnicas**
Entidades: Registros BPM (temperatura), Equipo. Hardware y protocolo de sensores a definir en un spike previo. Condición de entrada: Fase 2 cumplida.

### F3-01 · Listas de precios por canal con margen objetivo

- **Labels:** Fase 3, M6 Cobranzas · **Prioridad:** 4 (Low) · **Estimación:** 5 · **Padre sugerido:** ROD-240 · **Bloqueada por:** RF-29 (ROD-271), RF-39

**Historia de usuario**
Como **dirección (Nahuel)** quiero fijar una lista de precios por canal con margen objetivo sobre el costo al día, para dejar de fijar precios sin costo y evitar vender bajo costo a supermercados.

**Criterios de aceptación**

- [ ] **Dado** un margen objetivo por canal (supermercados, revendedores, local), **cuando** se define, **entonces** el sistema calcula el precio sugerido = costo directo ÷ (1 − margen objetivo) (regla 9).
- [ ] **Dado** el costo directo vigente de la bolsa (~$3.210 en el relevamiento), **cuando** se muestra cada precio actual ($4.200 mayorista, $4.800 minorista y el de supermercados a relevar), **entonces** se ve el margen real y la diferencia contra el objetivo.
- [ ] **Dado** un precio por debajo del costo directo, **cuando** se guarda, **entonces** se advierte y se pide confirmación.
- [ ] **Dado** el costo variable (~$2.800 por bolsa en el relevamiento), **cuando** se evalúa un cliente de volumen, **entonces** se muestra el margen de contribución frente a la capacidad que ocupa.
- [ ] **Dado** un cambio del costo (nueva compra o rendimiento), **cuando** ocurre, **entonces** se avisa qué canales quedaron por debajo del margen objetivo.

**Notas técnicas**
Entidades: Cliente (lista de precios), Producto, Pedido e ítems, Receta/Compra. Regla 9. Extiende RF-29. Problema 2 del relevamiento (precios sin costo al día ni margen por canal).

### F3-02 · Producción nivelada a 150 kg/día y stock de seguridad

- **Labels:** Fase 3, M4 Producción · **Prioridad:** 4 (Low) · **Estimación:** 8 · **Padre sugerido:** ROD-238 · **Bloqueada por:** RF-19 (ROD-244), RF-16 (ROD-252)

**Historia de usuario**
Como **jefa de producción** quiero producir de forma nivelada hasta 150 kg/día y mantener stock de seguridad de los productos que más salen, para que un pedido grande no desordene la semana y se use la capacidad ya pagada.

**Criterios de aceptación**

- [ ] **Dado** la capacidad de 150 kg/día y el promedio actual de ~100 kg/día, **cuando** se genera el plan, **entonces** propone nivelar la producción hacia 150 kg/día usando la capacidad libre para producir stock.
- [ ] **Dado** los productos que más salen, **cuando** se define un stock de seguridad (como una semana, ~500 kg en el relevamiento), **entonces** el plan repone hasta ese nivel.
- [ ] **Dado** el stock de seguridad definido, **cuando** se calcula, **entonces** muestra el capital inmovilizado en ingredientes (~$2,7M para una semana en el relevamiento) con costos al día.
- [ ] **Dado** la vida útil de 6 meses congelado, **cuando** se planifica stock, **entonces** advierte lotes que superarían un porcentaje de su vida útil sin salir.
- [ ] **Dado** un pedido grande, **cuando** entra, **entonces** el plan lo absorbe con el stock de seguridad antes de desordenar la producción.
- [ ] **Dado** el indicador "Uso de capacidad", **cuando** se mide, **entonces** sube respecto a la base (~67%).

**Notas técnicas**
Entidades: Producción (plan), Lote terminado, Movimiento de stock, Pedido. Problema 12 del relevamiento. El abatidor (F1 y F2) es el cuello de botella y es la restricción del plan.

### F3-03 · Oferta de granel para supermercados

- **Labels:** Fase 3, M1 Pedidos · **Prioridad:** 4 (Low) · **Estimación:** 5 · **Padre sugerido:** ROD-235 · **Bloqueada por:** F3-01

**Historia de usuario**
Como **dirección (Nahuel)** quiero una oferta de granel para supermercados con precio calculado, para recuperar la facturación de los supermercados que fraccionan y hoy le compran a una empresa de La Plata.

**Criterios de aceptación**

- [ ] **Dado** el producto granel (bolsa de 5 kg por forma), **cuando** se arma la oferta, **entonces** tiene precio por kg calculado desde el costo y un margen objetivo del canal.
- [ ] **Dado** un supermercado, **cuando** se le ofrece granel, **entonces** el pedido se carga por forma ("5 kg de tapitas") con su lista de precios.
- [ ] **Dado** el volumen potencial de un supermercado, **cuando** se evalúa, **entonces** se muestra qué % de la capacidad libre ocuparía.
- [ ] **Dado** una oferta enviada, **cuando** se registra, **entonces** queda seguimiento (enviada, aceptada, rechazada) con motivo.
- [ ] **Dado** el costo del granel, **cuando** se calcula, **entonces** no incluye el envase unitario de 0,5 kg (se usa el de 5 kg).

**Notas técnicas**
Entidades: Producto (granel), Cliente (canal supermercados), Pedido, Lista de precios. Problema 13 del relevamiento. Depende de tener costos al día (RF-39) y listas de precios (RF-29, F3-01). Precio a supermercados sin relevar hoy.

### F3-04 · Piloto con distribuidor de Buenos Aires

- **Labels:** Fase 3 · **Prioridad:** 4 (Low) · **Estimación:** 8 · **Padre:** ninguno · **Bloqueada por:** RF-39, F3-01

**Historia de usuario**
Como **dirección (Nahuel)** quiero un piloto con un distribuidor de Buenos Aires con el costo ya conocido, para negociar sin vender por debajo del costo.

**Criterios de aceptación**

- [ ] **Dado** el costo directo actualizado (~$3.210 por bolsa en el relevamiento), **cuando** se evalúa la propuesta, **entonces** se calcula el precio mínimo a partir de la regla 9, incluido el costo logístico de congelado hasta Buenos Aires.
- [ ] **Dado** que el distribuidor pide un 25% sobre $4.200 (precio de ~$3.150, por debajo del costo directo), **cuando** se evalúa, **entonces** el análisis muestra el margen negativo y qué costo habría que bajar para que cierre.
- [ ] **Dado** el piloto, **cuando** se define, **entonces** tiene volumen, duración, precio acordado y criterio de éxito escritos.
- [ ] **Dado** la capacidad libre, **cuando** se evalúa el volumen, **entonces** no compromete más capacidad que la libre.
- [ ] **Dado** el cierre del piloto, **cuando** termina, **entonces** hay un informe de margen real y una decisión (seguir, ajustar o frenar).

**Notas técnicas**
No depende solo de software. Condición del relevamiento: piloto después de la Fase 2 y con el costo ya conocido. Entidades: Cliente, Pedido, Ruta/costos logísticos.

### F3-05 · Relevamiento de mercado en Madrid y evaluación de HACCP

- **Labels:** Fase 3 · **Prioridad:** 4 (Low) · **Estimación:** 5 · **Padre:** ninguno · **Bloqueada por:** ninguna

**Historia de usuario**
Como **dirección (Nahuel)** quiero un relevamiento de mercado en Madrid (diciembre) y una evaluación de HACCP, para decidir con datos si exportar es viable en un horizonte de 2 a 3 años.

**Criterios de aceptación**

- [ ] **Dado** el relevamiento en Madrid, **cuando** se hace, **entonces** cubre tiendas latinas, precios del pan de queso brasileño congelado y 2 o 3 importadores contactados.
- [ ] **Dado** los datos, **cuando** se analizan, **entonces** se calcula el precio objetivo de ingreso frente al costo conocido.
- [ ] **Dado** la evaluación de HACCP, **cuando** se hace, **entonces** se documenta la brecha entre las BPM actuales (RNE, RNPA, habilitación de ASSAL) y un plan HACCP, con costo y plazo estimados.
- [ ] **Dado** los requisitos de exportación, **cuando** se revisan, **entonces** se listan habilitación SENASA y requisitos de la UE para productos con lácteo y huevo, marcados "a confirmar con SENASA".
- [ ] **Dado** el resultado, **cuando** se presenta, **entonces** hay una recomendación de seguir o no, con los datos que faltan.

**Notas técnicas**
No es software. Entidades: ninguna directa; el HACCP se apoya en los registros BPM (M7) y la trazabilidad (RF-35). Horizonte de exportación del relevamiento: 2 a 3 años.
