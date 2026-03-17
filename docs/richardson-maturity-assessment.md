# Evaluación de madurez REST (modelo de Richardson)

## Veredicto

**La API está mayoritariamente en Nivel 2 (Recursos + Verbos HTTP + códigos de estado), con algunos endpoints todavía orientados a acciones y sin HATEOAS, por lo que no llega a Nivel 3.**

## Evidencia

### Nivel 1 (Recursos): cumplido

La API está dividida en múltiples URIs de recursos y subrecursos, por ejemplo:

- `/api/mobile/users/:userId/documents`
- `/api/mobile/users/:userId/coupons`
- `/api/mobile/bookings/:bookingId`
- `/api/stripe/payment-intents/:paymentIntentId`

Esto evita el patrón de un único endpoint tipo `POST /api/service`.

### Nivel 2 (Verbos HTTP): cumplido en gran parte

Se usan varios métodos HTTP de forma semántica:

- `GET` para lectura (`/services`, `/users/:userId/products`, `/payment-intents/:id`).
- `POST` para creación (`/bookings`, `/users/:userId/documents`, `/payment-intents`).
- `PUT/PATCH` para actualización (`/user`, `/bookings/:id`, `/payment-intents/:id/state`).
- `DELETE` para borrado/cancelación (`/bookings/:bookingId`, `/subscription/:subscriptionId`).

También se observan respuestas con códigos de estado explícitos, por ejemplo en `/api/health` y en rutas de documentos que devuelven `404` cuando no existe el archivo.

### Nivel 3 (HATEOAS): no cumplido

No se observan respuestas que incluyan controles hipermedia (enlaces del tipo `links`, `_links`, `rel`, etc.) para descubrir transiciones de estado o acciones siguientes.

## Matiz importante

Existen endpoints con estilo RPC/acción (`/change-password`, `/reset-password`, `/payments/setup-config`) que, aunque válidos en casos prácticos, reducen la pureza REST del diseño. Aun así, el diseño general sigue estando más cerca de Nivel 2 que de Nivel 1.
