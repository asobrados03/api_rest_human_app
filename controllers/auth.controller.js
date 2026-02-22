import * as authService from "../services/auth.service.js";
import { logActivity } from "../utils/logger.js";

import logger from '../utils/pino.js';
export async function registerUser(req, res) {
    try {
        const body = req.body || {};
        // Añadir archivo si existe
        if (req.file) body.profilePicFilename = req.file.filename;

        const result = await authService.registerUserService(req.db, body);

        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `Registered new user: ${result.email}`,
                userId: result.userId
            });
        } catch (logErr) {
            logger.error("⚠️ Logging error (registerUser):", logErr);
        }

        return res.status(201).json({ message: 'Se ha creado el registro correctamente' });
    } catch (err) {
        logger.error('Error en registerUser:', err);
        const status = err.status || 500;
        const message = err.message || 'Error interno al crear el usuario';
        return res.status(status).json({ error: message });
    }
}

export async function loginUser(req, res) {
    try {
        const result = await authService.loginUserService(req.db, req.body || {});
        return res.status(200).json({
            ...result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken
        });
    } catch (err) {
        logger.error('Error en loginUser:', err);
        const status = err.status || 500;
        const message = err.message || 'Error interno al iniciar sesión';
        return res.status(status).json({ error: message });
    }
}

export async function refreshTokenController(req, res) {
    try {
        const authHeader = req.headers.authorization || '';
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Refresh token requerido' });
        }
        const oldRefresh = authHeader.slice(7);

        const tokens = authService.refreshTokensService(oldRefresh);
        return res.status(200).json(tokens);
    } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
    }
}

export async function updateUserPayInfo(req, res) {
    try {
        const result = await authService.updatePayInfoService(req.db, req.body || {});

        await logActivity(req, {
            subject: `Updated user info (dni/direccionPostal) for user ${result.user_id}`,
            userId: result.user_id
        });

        return res.json({ message: 'Datos actualizados correctamente' });
    } catch (err) {
        logger.error('Error en updateUserPayInfo:', err);
        const status = err.status || 500;
        return res.status(status).json({ error: err.message || 'Error interno' });
    }
}

export async function changePassword(req, res) {
    try {
        const { currentPassword, newPassword, userId } = req.body || {};
        const userIdToken = req.user_payload.id; // Asumiendo middleware de auth

        const result = await authService.changePasswordService(req.db, {
            currentPassword,
            newPassword,
            userId,
            userIdToken
        });

        await logActivity(req, {
            subject: `User ${result.userId} changed their password`,
            userId: result.userId
        });

        return res.status(200).json({ message: 'Has cambiado la contraseña exitosamente' });
    } catch (err) {
        logger.error('Error changePassword:', err);
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
    }
}

export async function resetPassword(req, res) {
    try {
        const { email } = req.body;
        await authService.resetPasswordService(req.db, email);

        await logActivity(req, {
            subject: `Contraseña restablecida para el usuario: ${email}`,
            userId: 0
        });

        return res.json({ message: 'Contraseña restablecida. Revisa tu correo.' });
    } catch (err) {
        logger.error('resetPassword error:', err);
        const status = err.status || 500;
        return res.status(status).json({ error: err.message || 'Error al restablecer' });
    }
}