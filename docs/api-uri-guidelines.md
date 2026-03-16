# Guía de URIs REST

## Convenciones de URI

- **Recursos en plural:** usar nombres de recursos en plural (`/users`, `/bookings`, `/services`).
- **kebab-case consistente:** para más de una palabra usar kebab-case (`/active-product-detail`, `/preferred-coach`).
- **Subrecursos:** colgar recursos secundarios del recurso padre (`/users/:userId/documents`, `/users/:userId/coupons`).

## Endpoints canónicos introducidos

- `GET /api/mobile/coaches`
- `GET /api/mobile/users/:userId/stats`
- `GET /api/mobile/users/:userId/products`
- `GET /api/mobile/users/:userId/coupons`
- `POST /api/mobile/users/:userId/coupons`
- `GET /api/mobile/users/:userId/documents`
- `POST /api/mobile/users/:userId/documents`
- `GET /api/mobile/users/:userId/documents/:filename`
- `DELETE /api/mobile/users/:userId/documents/:filename`

## Compatibilidad temporal y deprecación

Durante el periodo de transición se mantienen aliases legacy para no romper integraciones:

- `/api/mobile/list_coaches` → `/api/mobile/coaches`
- `/api/mobile/user-stats` → `/api/mobile/users/:userId/stats`
- `/api/mobile/user-products` y `/api/mobile/user-product` → `/api/mobile/users/:userId/products`
- `/api/mobile/users/:userId/coupon` → `/api/mobile/users/:userId/coupons`
- `/api/mobile/user/document*` y `/api/mobile/user/documents` → `/api/mobile/users/:userId/documents*`

### Headers de deprecación en aliases

Los aliases legacy responden con:

- `Deprecation: true`
- `Sunset: Wed, 30 Sep 2026 23:59:59 GMT`
- `Warning: 299 - "Deprecated API route. Use <ruta_nueva>"`
- `Link: <<ruta_nueva>>; rel="successor-version"`

## Calendario de deprecación

- **2026-03-16:** publicación de rutas canónicas y aliases de compatibilidad.
- **2026-09-30:** fecha de sunset anunciada para rutas legacy.
- **Desde 2026-10-01:** eliminación planificada de aliases deprecated.
