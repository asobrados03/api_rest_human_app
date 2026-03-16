import * as userService from '../services/user.service.js';
import { logActivity } from "../utils/logger.js";

import logger from '../utils/pino.js';
function handleError(res, err, context) {
    logger.error({ err }, `❌ Error en ${context}`);
    const status = err.status || 500;
    const message = err.message || "Error interno del servidor";
    return res.status(status).json({ error: message });
}

export async function getUser(req, res) {
    try {
        const { user_id } = req.query;
        if (!user_id) return res.status(400).json({ error: "Falta user_id" });

        const user = await userService.getUserByIdService(req.db, user_id);
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        return res.status(200).json(user);
    } catch (err) {
        return handleError(res, err, 'getUser');
    }
}

export async function getUserSubscriptions(req, res) {
    try {
        const subs = await userService.getUserSubscriptionsService(req.db);
        return res.status(200).json({ subscriptions: subs });
    } catch (err) {
        return handleError(res, err, 'getUserSubscriptions');
    }
}

export async function getSubscriptionsHistory(req, res) {
    try {
        const history = await userService.getSubscriptionsHistoryService(req.db);
        return res.status(200).json({ history });
    } catch (err) {
        return handleError(res, err, 'getSubscriptionsHistory');
    }
}

export async function updateUser(req, res) {
    try {
        const resultUser = await userService.updateUserService(req.db, {
            rawUserJson: req.body.user,
            file: req.file,
            tokenPayload: req.user_payload
        });

        await logActivity(req, {
            subject: `El usuario ${resultUser.email} (ID: ${resultUser.id}) actualizó su perfil`,
            userId: resultUser.id
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.status(200).json(resultUser);
    } catch (err) {
        return handleError(res, err, 'updateUser');
    }
}

export async function deleteUser(req, res) {
    try {
        const { email: rawEmail } = req.query;
        const tokenEmail = req.user_payload.email;

        const result = await userService.deleteUserService(req.db, { rawEmail, tokenEmail });

        await logActivity(req, {
            subject: `El usuario con email ${result.email} fue eliminado (via Mobile)`,
            userId: result.userId,
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.status(200).json({ message: `Usuario '${result.email}' eliminado correctamente` });
    } catch (err) {
        return handleError(res, err, 'deleteUser');
    }
}

export async function getCoaches(req, res) {
    try {
        const rows = await userService.getCoachesService(req.db);
        logger.info('User getCoaches completado', { total: rows?.length || 0 });
        return res.status(200).json(rows);
    } catch (err) {
        return handleError(res, err, 'getCoaches');
    }
}

export async function assignPreferredCoach(req, res) {
    try {
        // Extraemos los datos del body que envía Kotlin
        const { service_name, customer_id, coach_id } = req.body;

        const result = await userService.assignPreferredCoachService(req.db, {
            service_name,
            customer_id,
            coach_id
        });

        // Log de actividad corregido
        await logActivity(req, {
            subject: `Usuario ${customer_id} marcó como favorito al coach ${coach_id}`,
            userId: Number(customer_id) || req.user_payload?.id || 0
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.status(result.status).json({
            message: result.message + ' correctamente.'
        });

    } catch (err) {
        return handleError(res, err, 'assignPreferredCoach');
    }
}

export async function getPreferredCoach(req, res) {
    try {
        const result = await userService.getPreferredCoachService(req.db, req.query.customer_id);

        await logActivity(req, {
            subject: `El usuario ${req.query.customer_id} consultó su coach preferido`,
            userId: req.user_payload.id || 0
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.status(200).json(result);
    } catch (err) {
        return handleError(res, err, 'getPreferredCoach');
    }
}

export async function getPreferredCoachWithService(req, res) {
    try {
        const result = await userService.getPreferredCoachWithServiceService(req.db, req.query);

        await logActivity(req, {
            subject: `El usuario ${req.query.customer_id} consultó su coach preferido con servicio`,
            userId: req.user_payload?.id || 0
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.status(200).json(result);
    } catch (err) {
        return handleError(res, err, 'getPreferredCoachWithService');
    }
}

export async function deleteProfilePic(req, res) {
    try {
        const result = await userService.deleteProfilePicService(req.db, {
            queryEmail: req.query.email,
            queryPicName: req.query.profilePictureName,
            tokenPayload: req.user_payload
        });

        await logActivity(req, {
            subject: `La foto de perfil del usuario ${result.email} fue eliminada`,
            userId: result.userId
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.status(200).json({ message: 'Foto de perfil eliminada correctamente' });
    } catch (err) {
        return handleError(res, err, 'deleteProfilePic');
    }
}

export async function getUserStats(req, res) {
    const user_id = req.params.userId || req.user_payload?.id || 0;

    try {
        const stats = await userService.getUserStatsService(req.db, user_id);

        await logActivity(req, {
            subject: `Consulta de estadísticas del usuario ${req.query.user_id}`,
            userId: Number(user_id)
        }).catch(e => logger.error({ e }, 'Log error:'));

        // Enviamos 'stats' directamente, sin el envoltorio { byService: ... }
        return res.status(200).json(stats);

    } catch (err) {
        return handleError(res, err, 'getUserStats');
    }
}

export async function addCouponToUser(req, res) {
    try {
        await userService.addCouponToUserService(req.db, {
            userId: Number(req.params.userId),
            coupon_code: req.body.coupon_code,
            tokenPayload: req.user_payload
        });

        await logActivity(req, {
            subject: `Cupón ${req.body.coupon_code} añadido al usuario ${req.params.userId}`,
            userId: Number(req.params.userId)
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.sendStatus(204);
    } catch (err) {
        return handleError(res, err, 'addCouponToUser');
    }
}

export async function removeCouponToUser(req, res) {
    try {
        if (!req.params?.couponCode) {
            return res.status(400).json({ error: 'Falta couponCode en la URI' });
        }

        await userService.removeCouponToUserService(req.db, {
            userId: Number(req.params.userId),
            coupon_code: req.params.couponCode,
            tokenPayload: req.user_payload
        });

        await logActivity(req, {
            subject: `Cupón ${req.params.couponCode} eliminado del usuario ${req.params.userId}`,
            userId: Number(req.params.userId)
        }).catch(e => logger.error({ e }, 'Log error:'));

        return res.sendStatus(204);
    } catch (err) {
        return handleError(res, err, 'removeCouponToUser');
    }
}

export async function getUserCoupon(req, res) {
    try {
        const coupons = await userService.getUserCouponService(req.db, {
            userId: Number(req.params.userId),
            tokenPayload: req.user_payload
        });

        logger.info('User getUserCoupon completado', { userId: Number(req.params.userId), total: coupons.length });

        if (coupons.length === 0) return res.sendStatus(204);
        return res.status(200).json(coupons);
    } catch (err) {
        return handleError(res, err, 'getUserCoupon');
    }
}

export async function getUserDocuments(req, res) {
    try {
        const docs = await userService.getUserDocumentsService(req.db, req.user_payload.id);

        logger.info('User getUserDocuments completado', { userId: req.user_payload.id, total: docs?.length || 0 });

        res.status(200).json(docs);
    } catch (err) { handleError(res, err, 'getUserDocuments'); }
}

export async function uploadUserDocument(req, res) {
    try {
        const result = await userService.uploadUserDocumentService(req.db, {
            userId: req.user_payload.id,
            file: req.file
        });

        await logActivity(req, {
            subject: `Documento subido por usuario ${req.user_payload.id}: ${req.file?.filename || 'archivo'}`,
            userId: req.user_payload.id
        }).catch(e => logger.error({ e }, 'Log error:'));

        res.status(201).json(result);
    } catch (err) { handleError(res, err, 'uploadUserDocument'); }
}

export async function deleteUserDocument(req, res) {
    try {
        const result = await userService.deleteUserDocumentService(req.db, {
            userId: req.user_payload.id,
            filename: req.params.filename
        });

        await logActivity(req, {
            subject: `Documento eliminado por usuario ${req.user_payload.id}: ${req.params.filename}`,
            userId: req.user_payload.id
        }).catch(e => logger.error({ e }, 'Log error:'));

        res.status(200).json(result);
    } catch (err) { handleError(res, err, 'deleteUserDocument'); }
}

export async function getEwalletBalance(req, res) {
    try {
        const userId = req.user_payload?.id || req.query.user_id; // Depende de si usas verifyToken
        const result = await userService.getEwalletBalanceService(req.db, userId);

        logger.info('User getEwalletBalance completado', { userId });

        res.status(200).json(result);
    } catch (err) { handleError(res, err, 'getEwalletBalance'); }
}

export async function getEwalletTransactions(req, res) {
    try {
        const userId = req.user_payload?.id || req.query.user_id;

        const transactions =
            await userService.getEwalletTransactionsService(req.db, userId);

        logger.info('User getEwalletTransactions completado', { userId, total: transactions?.length || 0 });

        res.status(200).json({ transactions });
    } catch (err) {
        handleError(res, err, 'getEwalletTransactions');
    }
}

export async function checkSavedPaymentMethod(req, res) {
    try {
        const result = await userService.checkSavedPaymentMethodService(req.db, req.user_payload.id);

        logger.info('User checkSavedPaymentMethod completado', { userId: req.user_payload.id });

        res.status(200).json(result);
    } catch (err) { handleError(res, err, 'checkSavedPaymentMethod'); }
}