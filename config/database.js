import './env.js';
import mysql from 'mysql2/promise';

import logger from '../utils/pino.js';
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'human_app',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

pool.on('connection', (conn) => {
    conn.on('error', (err) => {
        logger.error({ err }, 'MySQL connection error');
    });
});

pool.on('error', (err) => {
    logger.error({ err }, 'MySQL pool error');
});

export default pool;
