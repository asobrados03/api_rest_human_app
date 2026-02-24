import logger from './pino.js';

export async function logActivity(req, { subject, userId = null }) {
    try {
        // 1. Verificación de seguridad de la base de datos
        const db = req.app?.get('db');
        if (!db) {
            // Usamos un warning porque si falla el log, no queremos que rompa la app principal
            logger.warn({ subject, userId }, '⚠️ No DB connection found in req.app. Skipping log.');
            return;
        }

        const { method, originalUrl, ip, headers } = req;
        const agent = headers['user-agent'] || 'unknown';

        // 2. Log estructurado (Pino prefiere el objeto primero)
        logger.info({ subject, method, url: originalUrl, userId }, "📝 Logging activity");

        // 3. Ejecución de la Query
        await db.query(`
            INSERT INTO log_activities (subject, url, method, ip, agent, user_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [subject, originalUrl, method, ip, agent, userId]);

    } catch (err) {
        // 4. Corregimos el log del error para Pino
        // Pasamos el objeto 'err' primero para que capture el stack trace completo
        logger.error({ err, subject, userId }, "⚠️ Failed to write log activity");

        logger.error({ err, subject, userId }, `❌ Failed to write log activity for subject: ${subject}`);
    }
}