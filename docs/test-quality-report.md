# Informe de calidad de tests (actualizado)

Fecha del análisis: 2026-04-14.

## Alcance revisado

- 18 suites (`11` unitarias + `7` de integración HTTP).
- 230 tests ejecutados, 230 en verde.
- Ejecución de referencia: `npm test -- --runInBand`.

---

## 1) Unit tests de servicios de negocio

### Suites incluidas
- `tests/unit/authService.test.js`
- `tests/unit/userService.test.js`
- `tests/unit/serviceProductsService.test.js`
- `tests/unit/productBookingService.test.js`
- `tests/unit/stripeService.test.js`

### ✅ Qué está bien hecho
- Cobertura funcional sólida de *happy path* y de errores de negocio clave (401, 404, 409, 402, validaciones de entrada, credenciales, permisos y existencia de entidades).
- Se testean fallos transaccionales relevantes (rollback por error en repositorio y por fallo de `commit`) en múltiples servicios.
- Hay foco en comportamiento de dominio observable: normalización de datos (`email`, `postcode`, `dni`, fechas), límites semanales de reservas, idempotencia de refund, etc.
- Nombres de test, en general, expresan claramente la regla de negocio (facilita diagnóstico cuando fallan).

### ⚠️ Qué se puede mejorar y por qué
- Hay una proporción alta de aserciones de interacción (`toHaveBeenCalledWith`/`toHaveBeenCalledTimes`) en lugar de aserciones de contrato externo del servicio; esto eleva el coste de refactorización interna.
- Algunos tests verifican payloads muy concretos de integración con Stripe o repositorios (campos exactos y forma exacta), cuando bastaría validar invariantes de salida + side effects de alto nivel.
- Se cubren muchos errores, pero faltan más combinaciones de edge cases temporales en booking/suscripciones (cambio de mes, leap year, límites de ventana UTC local).

### 🔴 Qué es problemático
- Sobreacoplamiento puntual a implementación:
  - tests que dependen del detalle exacto de llamadas a repositorio/transacción (orden y número de llamadas) y podrían fallar ante refactors neutrales.
  - tests con alta especificidad de objetos intermedios no siempre visibles para el consumidor del servicio.
- Cobertura insuficiente de ciertos errores de infraestructura de segundo nivel en unitarios (por ejemplo, “falla rollback” o “release lanza excepción”) que podrían ocultar fugas de conexión.

### 💡 Sugerencia concreta
- Mantener 20-30% de tests de interacción (para límites críticos), y mover el resto a contrato:
  - **Given/When/Then** centrado en `input -> output/error` + estado final esperado.
- Introducir tablas de casos para fechas en booking/suscripción (`YYYY-MM-DD` frontera de mes, año bisiesto, cambio de horario) con expectativas explícitas por zona horaria.
- Añadir pruebas de robustez de cleanup de conexión (`release`/`rollback` defensivo) donde el riesgo operativo sea alto.

---

## 2) Unit tests de middlewares y utilidades

### Suites incluidas
- `tests/unit/verifyToken.test.js`
- `tests/unit/uploadProfile_Pic.test.js`
- `tests/unit/uploadDocument.test.js`
- `tests/unit/dateHandler.test.js`
- `tests/unit/stripeUtils.test.js`
- `tests/unit/logger.test.js`

### ✅ Qué está bien hecho
- Predomina el testeo de comportamiento observable en middleware: status code, mensaje de error y flujo `next()`.
- Muy buena cobertura de funciones puras (`date-handler`, `stripe-utils`) con entradas válidas/ inválidas, redondeos y normalización de datos.
- Cobertura explícita de escenarios de fallo realistas en upload (tipo MIME, tamaño, errores del FS).

### ⚠️ Qué se puede mejorar y por qué
- `logger.test.js` sigue algo acoplado a detalles de persistencia (query/llamadas) más que al contrato operativo: “registrar sin romper request”.
- `dateHandler` tiene buena base internacional, pero aún puede ampliar inputs ambiguos de localización y abreviaturas mixtas para blindar regresiones.

### 🔴 Qué es problemático
- Contratos potencialmente accidentales normalizados como válidos (p. ej. coerciones discutibles como `null -> 'null'` en normalización de texto) pueden fijar comportamientos no deseados a largo plazo.

### 💡 Sugerencia concreta
- Para logger: validar resultado funcional (no rompe flujo, registra evento con severidad correcta) y reducir asserts de estructura interna de query.
- Para date-handler: añadir batería parametrizada “input ambiguo -> output esperado” con casos de i18n y formatos sucios.

---

## 3) Tests de integración HTTP

### Suites incluidas
- `tests/integration/app-core.test.js`
- `tests/integration/health.test.js`
- `tests/integration/auth.test.js`
- `tests/integration/user.test.js`
- `tests/integration/service-products.test.js`
- `tests/integration/bookings.test.js`
- `tests/integration/stripe.test.js`

### ✅ Qué está bien hecho
- Cobertura amplia de endpoints críticos y secundarios con `supertest`: autenticación, usuarios, bookings, productos y Stripe.
- Se validan correctamente contratos HTTP principales (status, payload mínimo esperado, errores comunes de validación/autorización).
- Existen casos de infraestructura en integración (DB down, filesystem errors) que aportan valor real de robustez.

### ⚠️ Qué se puede mejorar y por qué
- Muchas suites de “integración” siguen siendo integración parcial (repositorios, auth y SDK externos mockeados), por lo que no validan completamente wiring real entre capas y dependencias.
- Existen tests tipo “batch endpoints -> 200” útiles como smoke, pero con baja sensibilidad a roturas semánticas de contrato en cada endpoint.

### 🔴 Qué es problemático
- El mock extensivo en integración reduce capacidad de detectar incompatibilidades reales de contratos entre controlador/servicio/repositorio (especialmente en cambios de SQL/schema o serialización de datos).
- Falta una capa de pruebas con DB real/efímera para rutas críticas, que capture regressions de integración reales (transacciones, tipos SQL, nullability, constraints).

### 💡 Sugerencia concreta
- Mantener las integraciones actuales (rápidas) y añadir una **capa complementaria**:
  - `contract integration` con DB efímera (subset de endpoints críticos).
  - pocos casos E2E con auth real y persistencia real (nightly o pre-release).
- Sustituir gradualmente algunos “todos 200” por validación de contrato JSON (campos obligatorios, tipos y semántica de negocio).

---

## Evaluación transversal por criterio solicitado

### 1. Cobertura funcional
- **Nivel actual**: Alto en caminos felices y errores frecuentes.
- **Huecos**: edge cases avanzados de calendario/concurrencia, y escenarios de integración real DB/FS/Stripe en CI principal.

### 2. Acoplamiento a implementación
- **Nivel actual**: Medio.
- **Principal causa**: exceso de aserciones de interacción interna en unit e integración parcial.

### 3. Claridad e intención
- **Nivel actual**: Alto.
- **Observación**: nomenclatura descriptiva y estructura AAA mayoritariamente consistente.

### 4. Calidad de integración
- **Nivel actual**: Medio-alto para HTTP/contracts básicos, medio para colaboración real entre componentes por uso intensivo de mocks.

---

## Resumen final

### Puntuación general de calidad: **8.2 / 10**

**Justificación:**
- Muy buena amplitud (230 tests) y buena disciplina de error handling.
- Mejora respecto a revisiones anteriores en cobertura de casos de infraestructura y contratos mínimos.
- Penalización principal: integración aún muy simulada en varias rutas y cierto sobreacoplamiento de assertions a implementación interna.

### Top 3 problemas más graves a corregir
1. **Integración demasiado mockeada en rutas críticas**, con poca validación contra DB real.
2. **Sobreespecificación en tests de interacción interna** (llamadas exactas/estructura interna) que fragiliza refactors.
3. **Cobertura incompleta de edge cases temporales/combinatorios** en reservas y vigencias.

### Top 3 buenas prácticas detectadas
1. **Cobertura extensa de estados HTTP y errores de negocio** en dominios clave.
2. **Uso consistente de tests transaccionales** (commit/rollback) en servicios de negocio.
3. **Buena legibilidad general** (nombres descriptivos y patrón Arrange/Act/Assert en la mayoría de suites).
