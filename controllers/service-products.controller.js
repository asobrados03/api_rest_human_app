import * as service from '../services/service-products.service.js';
import { logActivity } from "../utils/logger.js";

import logger from '../utils/pino.js';
export function testMobileRoute(req, res) {
    res.json({ message: 'Ruta activa para el bloque: movil' });
}

export async function getAllServices(req, res) {
    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.listAllServices(connection);
        logger.info({ total: data?.length || 0 }, '[SERVICE_PRODUCTS] getAllServices completado');
        res.json(data);
    } catch (err) {
        logger.error({ err }, '[ERROR] GET /services');
        res.status(500).json({ error: 'Error al obtener los servicios', details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function getServiceProducts(req, res) {
    const { primary_service_id } = req.query;
    if (isNaN(primary_service_id)) {
        return res.status(400).json({ error: 'Parámetro ID inválido' });
    }

    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.listServiceProducts(connection, primary_service_id);
        logger.info({ primary_service_id, total: data?.length || 0 }, '[SERVICE_PRODUCTS] getServiceProducts completado');
        res.json(data);
    } catch (err) {
        logger.error({ err }, '[ERROR] GET /service-products');
        res.status(500).json({ error: 'Error al obtener productos', details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function getUserProducts(req, res) {
    const { user_id } = req.query;
    if (isNaN(user_id)) {
        return res.status(400).json({ error: 'Parámetro user_id inválido o ausente' });
    }

    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.listUserProducts(connection, user_id);
        logger.info({ user_id, total: data?.length || 0 }, '[SERVICE_PRODUCTS] getUserProducts completado');
        res.json(data);
    } catch (err) {
        logger.error({ err }, '[ERROR] GET /user-products');
        res.status(500).json({ error: 'Error al obtener productos del usuario', details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function assignProductToUser(req, res) {
    const { userId } = req.params;
    const { product_id, payment_method } = req.body;
    const user_id = Number(userId);

    if (!user_id || !product_id || !payment_method) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
    }

    let connection;
    try {
        connection = await req.db.getConnection();
        const result = await service.assignProduct(connection, { ...req.body, user_id });

        // Logging se mantiene en controller porque requiere 'req'
        await logActivity(req, { subject: `Producto ${product_id} asignado a ${user_id}`, userId: user_id });

        res.json({ success: true, ...result });
    } catch (err) {
        logger.error({ err }, '[ERROR] POST /assign-product');
        const status = err.status || 500;
        const message = err.message || 'Error al asignar producto';
        res.status(status).json({ error: message, details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function unassignProductFromUser(req, res) {
    const { userId, productId } = req.params;
    const user_id = Number(userId);
    const product_id = Number(productId);

    if (!user_id || !product_id) return res.status(400).json({ error: 'Faltan parámetros' });

    let connection;
    try {
        connection = await req.db.getConnection();
        const result = await service.unassignProduct(connection, user_id, product_id);
        await logActivity(req, {
            subject: `Producto ${product_id} desasignado del usuario ${user_id}`,
            userId: Number(user_id)
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (unassignProductFromUser):'));

        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function getActiveProductDetail(req, res) {
    const { user_id, product_id } = req.query;
    if (!user_id || !product_id) return res.status(400).json({ error: 'Faltan parámetros' });

    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.getActiveProductDetail(connection, user_id, product_id);
        logger.info({ user_id, product_id }, '[SERVICE_PRODUCTS] getActiveProductDetail completado');
        res.json(data);
    } catch (err) {
        const status = err.status || 500;
        res.status(status).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
}
/**
 * GET /api/products/:id
 */
export async function getProductDetailForHireProduct(req, res) {
    try {
        const productId = Number(req.params.id);

        const product = await service.getProductDetail(req.db, productId);

        logger.info({ productId }, '[SERVICE_PRODUCTS] getProductDetailForHireProduct completado');

        res.status(200).json(product);  // ← Sin el wrapper { product: ... }
    } catch (error) {
        logger.error({ error }, '[ERROR] GET /api/products/:id');
        const status = error.status || 500;
        res.status(status).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
}
