# Informe de calidad de tests

Fecha del análisis: 2026-04-10.

## Alcance revisado

- 11 suites unitarias en `tests/unit`.
- 7 suites de integración HTTP en `tests/integration`.
- 206 tests ejecutados (todos en verde).

---

## 1) Unit tests de servicios de negocio

### `authService.test.js`, `userService.test.js`, `serviceProductsService.test.js`, `productBookingService.test.js`, `stripeService.test.js`

✅ **Qué está bien**
- Cubren happy path y varios errores de negocio importantes (401, 404, 409, 402, validaciones de campos y formato).
- Incluyen escenarios de transacción/rollback en casos críticos (registro, actualización/eliminación de usuario, asignación de producto).
- Los nombres de los tests suelen expresar la regla de negocio que se valida.

⚠️ **Qué se puede mejorar**
- En varios casos se asertan llamadas al repositorio con detalles muy concretos (arrays de SQL fragments, argumentos exactos), lo que aumenta el coste de refactor sin ganar tanta confianza funcional.
- Algunas reglas de dominio complejas (especialmente Stripe y bookings) se validan más por “interacción interna” que por contrato de salida final.

🔴 **Qué es problemático**
- Hay acoplamiento visible a implementación interna en pruebas como:
  - `updateUserService` verificando lista exacta de campos SQL en `updateUserDynamic`.
  - `registerUserService`/`assignProduct` comprobando múltiples llamadas internas más que invariantes de salida.
  - `stripeService` muy orientado a estructura de payload interna en llamadas a SDK.
- Falta de cobertura de algunos caminos negativos relevantes:
  - Errores transitorios de DB en flujos principales (ej. fallo en `commit`, fallo de repositorio intermedio).
  - Casos borde de fechas/timezone en booking y renovaciones (fin de mes, DST, UTC/local).

💡 **Sugerencias concretas**
- Reescribir parte de los asserts hacia contratos externos:
  - Validar shape/códigos del resultado y side-effects de alto nivel (estado final), en vez de arrays internos exactos.
- Añadir tests de resiliencia por servicio:
  - “si falla repositorio X -> rollback + error normalizado”.
- En servicios de fechas/reservas, parametrizar tests con tabla de casos límite de calendario.

---

## 2) Unit tests de middlewares y utilidades

### `verifyToken.test.js`, `uploadProfile_Pic.test.js`, `uploadDocument.test.js`, `logger.test.js`, `dateHandler.test.js`, `stripeUtils.test.js`

✅ **Qué está bien**
- Buenos tests de comportamiento observable en middleware: códigos HTTP, payload de error y `next()`.
- `stripeUtils` y `dateHandler` prueban bien funciones puras con entradas válidas e inválidas.
- `uploadDocument` y `uploadProfile_Pic` cubren rutas de error y validación de tipos/tamaño.

⚠️ **Qué se puede mejorar**
- `logger.test.js` valida estructura concreta del SQL (`stringContaining('INSERT INTO log_activities')`) y número de llamadas de logger; puede romper por refactor benigno.
- En utilidades de fecha faltan casos con locale y formatos ambiguos adicionales.

🔴 **Qué es problemático**
- En `dateHandler`, el caso `null -> 'null'` en `stripDiacritics` está testeado como esperado; conviene revisar si ese contrato es realmente deseado o un comportamiento accidental.

💡 **Sugerencias concretas**
- En `logger` priorizar comprobar que “se intentó persistir actividad y no rompe el request” sin fijar forma interna de query.
- Añadir tests de regresión semántica para `date-handler` con matriz de entradas internacionales (abreviaturas, mayúsculas, acentos mixtos).

---

## 3) Tests de integración HTTP

### `app-core.test.js`, `health.test.js`, `auth.test.js`, `user.test.js`, `service-products.test.js`, `bookings.test.js`, `stripe.test.js`

✅ **Qué está bien**
- Cobertura amplia de endpoints principales, incluyendo rutas protegidas sin token (401) y validaciones de entrada (400).
- Se prueban flujos end-to-end de API con `supertest` y app real.
- Hay varios casos de error de negocio bien representados (conflictos, no encontrados, idempotencia en refund).

⚠️ **Qué se puede mejorar**
- Son “integraciones parciales”: se mockea repositorio y token casi siempre, por lo que no validan contratos reales con DB ni middleware real de auth en la mayoría de suites.
- Hay tests agregados tipo “todos los endpoints devuelven 200” que detectan humo, pero no garantizan contrato de respuesta por endpoint.

🔴 **Qué es problemático**
- Mocking interno extenso dentro de integración reduce valor de detectar roturas entre capas reales.
- Falta de cobertura explícita de algunos contratos/rutas relevantes:
  - Descarga de documento (`GET /users/:userId/documents/:filename`).
  - Casos de fallo de infraestructura intermedia (pool sin conexión, errores de FS en rutas de documento en integración).

💡 **Sugerencias concretas**
- Introducir una capa de integración “contract-first” con DB efímera (sqlite/mysql contenedor) para al menos rutas críticas.
- Mantener los tests actuales rápidos, pero añadir un subconjunto nightly con dependencias reales.
- Sustituir parte de los tests “batch 200” por verificaciones de contrato (campos obligatorios, tipos, semántica de negocio).

---

## Cobertura funcional transversal

✅ **Fortalezas**
- Happy paths centrales están presentes en auth, user, bookings, productos y stripe.
- Hay validaciones de error habituales (401/404/409/500) y validación de entrada en varias rutas.

⚠️ **Mejorables**
- Cobertura de edge cases técnicos (concurrencia, timezone, fin de período, operaciones idempotentes repetidas más allá de refund).

🔴 **Huecos potencialmente críticos**
- Contratos completos de integración real DB/FS/Stripe no cubiertos en CI principal.
- Algunos endpoints secundarios con cobertura parcial (descarga documentos).

💡 **Plan sugerido (incremental)**
1. Añadir tests de contrato para 6 endpoints críticos (auth login, refresh, assign product, reserve booking, refund, get user).
2. Añadir 10 tests de edge cases de fecha y límites de sesiones/productos.
3. Incorporar 1 suite nightly con DB real y sin mock de `verifyToken` para rutas prioritarias.

---

## Puntuación general (1-10)

**7.6 / 10**

Justificación: volumen y amplitud de cobertura muy buenos (206 tests, rutas principales cubiertas), claridad general adecuada y buena disciplina de casos de error. El principal descuento viene por acoplamiento a implementación en unit tests y por una integración todavía muy mockeada para detectar fallos reales entre capas.

---

## Top 3 problemas más graves a corregir

1. **Exceso de acoplamiento en unit tests de servicios** (asserts sobre detalles internos/llamadas exactas).
2. **Integración parcialmente “simulada”** (repositorios/auth mockeados en la mayoría de suites), con menor capacidad para detectar fallos reales de wiring.
3. **Falta de edge cases críticos de calendario/concurrencia** en reglas de reservas, renovaciones y expiraciones.

## Top 3 buenas prácticas detectadas

1. **Cobertura extensa de estados HTTP y flujos de error** en endpoints principales.
2. **Buena organización por dominio** (auth, bookings, stripe, user, products) y nomenclatura de tests mayormente descriptiva.
3. **Uso consistente de Arrange/Act/Assert** y aislamiento de dependencias externas en unit tests.
