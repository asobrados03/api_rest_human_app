import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from "dotenv";

dotenv.config();

import prodReserveMobileRoutes from './routes/prod-and-reserve.js';
import serviceProductsMobileRoutes from './routes/service-products.js';
import paymentMobileRoutes from './routes/payments.js';
import authMobileRoutes from './routes/auth.js';
import userMobileRoutes from './routes/user.js';

import path from 'path';
import fs from 'fs';

const app = express();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

pool.on('connection', (conn) => {
    conn.on('error', err => {
        console.error('MySQL connection error:', err)
    })
})
pool.on('error', err => {
    console.error('MySQL pool error:', err)
})

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
        console.error('❌ Error en /api/health:', err.message);
        res.status(500).json({ ok: false, error: 'DB not responding' });
    }
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
app.use('/api/payments', paymentMobileRoutes);

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