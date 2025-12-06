export async function logActivity(req, { subject, userId = null }) {
    try {
        const db = req.app.get('db');
        if (!db) throw new Error('❌ No DB connection in req.app');

        const { method, originalUrl, ip, headers } = req;
        const agent = headers['user-agent'] || '';

        console.log("📝 Logging activity:", { subject, method, originalUrl, userId });

        await db.query(`
      INSERT INTO log_activities (subject, url, method, ip, agent, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [subject, originalUrl, method, ip, agent, userId]);
    } catch (err) {
        console.error("⚠️ Failed to write log activity:", err.message, err.stack);

        console.error("⚠️ Failed to write log activity:", err);
    }
}