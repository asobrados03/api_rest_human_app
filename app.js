import express from 'express';

import pool from './config/database.js';
import prodReserveMobileRoutes from './routes/product-booking.routes.js';
import serviceProductsMobileRoutes from './routes/service-products.routes.js';
import stripeMobileRoutes from './routes/stripe.routes.js';
import authMobileRoutes from './routes/auth.routes.js';
import userMobileRoutes from './routes/user.routes.js';

import path from 'path';
import fs from 'fs';

import logger from './utils/pino.js';
const app = express();

app.set('db', pool);

app.get('/api/ping', (req, res) => {
    res.json({ message: '¡ping, funcionó!' });
});

app.get('/api/health', async (req, res) => {
    try {
        const conn = await req.app.get('db').getConnection();
        await conn.ping();
        conn.release();
        res.status(200).json({ ok: true });
    } catch (err) {
        logger.error({ errMessage: err.message }, '❌ Error en /api/health:');
        res.status(500).json({ ok: false, error: 'DB not responding' });
    }
});

app.use('/api/stripe', stripeMobileRoutes);


// Documentación OpenAPI/Swagger
const OPENAPI_FILE_PATH = path.join(process.cwd(), 'docs', 'openapi.yaml');

app.get('/api/openapi.yaml', (req, res) => {
    res.type('application/yaml');
    res.sendFile(OPENAPI_FILE_PATH);
});

app.get('/api/docs', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Human App API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.yaml',
      dom_id: '#swagger-ui'
    });
  </script>
</body>
</html>`);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Directorios híbridos: estáticos en repo, uploads fuera
const STATIC_PICTURES_PATH = path.join(process.cwd(), 'pictures');
const UPLOAD_PATH = process.env.NODE_ENV === 'production'
    ? '/var/uploads/human-app'
    : path.join(process.cwd(), 'pictures');

// Crear directorios de upload si no existen
const ensureUploadDirs = () => {
    const dirs = [
        path.join(UPLOAD_PATH, 'profile_pic'),
        path.join(UPLOAD_PATH, 'document')
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

ensureUploadDirs();

app.get('/api/document/:filename', (req, res) => {
    const DOCUMENTS_DIR = path.join(UPLOAD_PATH, 'document');
    const filePath = path.join(DOCUMENTS_DIR, req.params.filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Document not found' });
    }

    res.download(filePath);
});

app.use('/api/mobile', prodReserveMobileRoutes);
app.use('/api/mobile', serviceProductsMobileRoutes);
app.use('/api/mobile', authMobileRoutes);
app.use('/api/mobile', userMobileRoutes);

// Imágenes de usuario (persistentes, fuera del repo)
app.use('/api/profile_pic', express.static(path.join(UPLOAD_PATH, 'profile_pic')));

// Imágenes estáticas del proyecto (en el repo)
app.use('/api/service_images', express.static(path.join(STATIC_PICTURES_PATH, 'service_images')));
app.use('/api/product_images', express.static(path.join(STATIC_PICTURES_PATH, 'product_images')));

app.use((req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.originalUrl
    });
});

export default app;