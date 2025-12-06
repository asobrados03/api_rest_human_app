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

const app = express();

const dbConfig = {
    host: 'localhost', // 127.0.0.1
    port: 3306,
    user: 'root',
    password: 'Selenium123',
    database: 'DEV_humanperformcent_hp',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    connectTimeout: 20000,          // ↑ raise to 20s
    acquireTimeout: 20000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,   // send TCP keep-alive every 10 s
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true
};

const pool = mysql.createPool(dbConfig)

pool.on('connection', (conn) => {
    conn.on('error', err => {
        console.error('MySQL connection error:', err)
    })
})
pool.on('error', err => {
    console.error('MySQL pool error:', err)
})

app.set('db', pool);

// Ruta base de prueba
app.get('/api/ping', (req, res) => {
    res.json({ message: '¡ping, funcionó!' });
});

// Ruta rápida de health chec
app.get('/api/health', async (req, res) => {
    try {
        // Ping ligero a MySQL para asegurar que respondes
        const conn = await req.app.get('db').getConnection();
        await conn.ping(); // operación rápida, no consulta
        conn.release();

        res.status(200).json({ ok: true });
    } catch (err) {
        console.error('❌ Error en /api/health:', err.message);
        res.status(500).json({ ok: false, error: 'DB not responding' });
    }
});

app.get('/api/document/:filename', (req, res) => {
    const DOCUMENTS_DIR = path.join(process.cwd(), 'pictures', 'document');
    const filePath = path.join(DOCUMENTS_DIR, req.params.filename);
    res.download(filePath); // <-- Esto envía Content-Disposition: attachment
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Rutas principales
app.use('/api/mobile', prodReserveMobileRoutes);
app.use('/api/mobile', serviceProductsMobileRoutes);
app.use('/api/mobile', authMobileRoutes);
app.use('/api/mobile', userMobileRoutes);
app.use('/api/mobile', blogMobileRoutes);
app.use('/api/payments', paymentMobileRoutes);
app.use('/api/profile_pic', express.static('/home/fran/human_backend/pictures/profile_pic'));
app.use('/api/service_images', express.static('/home/fran/human_backend/pictures/service_images'));
app.use('/api/product_images', express.static('/home/fran/human_backend/pictures/product_images'));

export default app;