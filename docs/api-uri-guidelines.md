# Guía de URIs REST

## Convenciones de URI

- **Recursos en plural:** usar nombres de recursos en plural (`/users`, `/bookings`, `/services`).
- **kebab-case consistente:** para más de una palabra usar kebab-case (`/active-product-detail`, `/preferred-coach`).
- **Subrecursos:** colgar recursos secundarios del recurso padre (`/users/:userId/documents`, `/users/:userId/coupons`).

## Endpoints canónicos

- `GET /api/mobile/coaches`
- `GET /api/mobile/users/:userId/stats`
- `GET /api/mobile/users/:userId/products`
- `GET /api/mobile/users/:userId/coupons`
- `POST /api/mobile/users/:userId/coupons`
- `GET /api/mobile/users/:userId/documents`
- `POST /api/mobile/users/:userId/documents`
- `GET /api/mobile/users/:userId/documents/:filename`
- `DELETE /api/mobile/users/:userId/documents/:filename`

## Eliminación de endpoints legacy

Los aliases legacy fueron eliminados y ya no forman parte de la API soportada.

Rutas eliminadas:

- `/api/mobile/list_coaches`
- `/api/mobile/user-stats`
- `/api/mobile/user-products` y `/api/mobile/user-product`
- `/api/mobile/users/:userId/coupon`
- `/api/mobile/user/document*` y `/api/mobile/user/documents`
