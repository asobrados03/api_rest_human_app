# Diagrama de clases (Mermaid) — Chain of Responsibility en este proyecto

Este diagrama está aterrizado a cómo funciona **este backend Express**:

- En rutas protegidas (por ejemplo `GET /user`), la cadena real es:
  1) middleware de inyección de DB (`router.use`),
  2) middleware `verifyToken`,
  3) controlador final (`getUser`, `updateUser`, etc.).
- Si `verifyToken` falla, responde `401` y **no** se ejecuta el controlador.
- El refresh token se resuelve en otra ruta (`POST /refresh`), y el cliente reintenta la ruta protegida con el nuevo access token.

```mermaid
classDiagram
    direction LR

    class MiddlewareLink {
      <<abstract>>
      +handle(req, res, next): void
    }

    class DbInjectorMiddleware {
      +handle(req, res, next): void
      +set req.db from app.get("db")
    }

    class VerifyTokenMiddleware {
      +handle(req, res, next): void
      +reads Authorization Bearer token
      +sets req.user_payload
      +on fail => 401
    }

    class UserController {
      +getUser(req, res): Promise~void~
      +updateUser(req, res): Promise~void~
      +deleteUser(req, res): Promise~void~
    }

    class AuthController {
      +refreshTokenController(req, res): Promise~void~
    }

    class ProtectedUserRoute {
      +GET /user
      +PUT /user
      +DELETE /user
    }

    MiddlewareLink <|-- DbInjectorMiddleware
    MiddlewareLink <|-- VerifyTokenMiddleware

    ProtectedUserRoute --> DbInjectorMiddleware : 1) router.use(...)
    DbInjectorMiddleware --> VerifyTokenMiddleware : 2) verifyToken
    VerifyTokenMiddleware --> UserController : 3) getUser/updateUser/deleteUser

    VerifyTokenMiddleware ..> AuthController : si 401, cliente llama POST /refresh
    AuthController ..> ProtectedUserRoute : cliente reintenta con nuevo access token

    note for VerifyTokenMiddleware "Si falla la validación JWT, la cadena se corta\ny NO llega al controlador"
    note for AuthController "El refresh en este proyecto no es un eslabón\nde la misma request protegida; ocurre en /refresh"
```

## Referencia directa a archivos del proyecto

- Middleware JWT: `middlewares/verifyToken.js`
- Cadena en rutas de usuario: `routes/user.routes.js`
- Controlador protegido ejemplo: `controllers/user.controller.js`
- Flujo refresh token: `routes/auth.routes.js` + `controllers/auth.controller.js`
