import * as service from '../services/service-products.service.js';
import { logActivity } from "../utils/logger.js";

export function testMobileRoute(req, res) {
    res.json({ message: 'Ruta activa para el bloque: movil' });
}

export async function getAllServices(req, res) {
    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.listAllServices(connection);
        res.json(data);
    } catch (err) {
        console.error('[ERROR] GET /services →', err);
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
        res.json(data);
    } catch (err) {
        console.error('[ERROR] GET /service-products →', err);
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
        res.json(data);
    } catch (err) {
        console.error('[ERROR] GET /user-products →', err);
        res.status(500).json({ error: 'Error al obtener productos del usuario', details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function assignProductToUser(req, res) {
    const { user_id, product_id, payment_method } = req.body;

    if (!user_id || !product_id || !payment_method) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
    }

    let connection;
    try {
        connection = await req.db.getConnection();
        const result = await service.assignProduct(connection, req.body);

        // Logging se mantiene en controller porque requiere 'req'
        await logActivity(req, { subject: `Producto ${product_id} asignado a ${user_id}`, userId: user_id });

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[ERROR] POST /assign-product →', err);
        const status = err.status || 500;
        const message = err.message || 'Error al asignar producto';
        res.status(status).json({ error: message, details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function unassignProductFromUser(req, res) {
    const { user_id, product_id } = req.query;
    if (!user_id || !product_id) return res.status(400).json({ error: 'Faltan parámetros' });

    let connection;
    try {
        connection = await req.db.getConnection();
        const result = await service.unassignProduct(connection, user_id, product_id);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function getProductDetails(req, res) {
    const { user_id, product_id } = req.query;
    if (!user_id || !product_id) return res.status(400).json({ error: 'Faltan parámetros' });

    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.getDetails(connection, user_id, product_id);
        res.json(data);
    } catch (err) {
        const status = err.status || 500;
        res.status(status).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function applyCoupon(req, res) {
    const { coupon_code } = req.body;
    let connection;
    try {
        connection = await req.db.getConnection();
        const result = await service.validateCoupon(connection, coupon_code);
        res.json({ success: true, ...result });
    } catch (err) {
        const status = err.status || 500;
        res.status(status).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function searchProducts(req, res) {
    const { query } = req.query;
    let connection;
    try {
        connection = await req.db.getConnection();
        const data = await service.searchProducts(connection, query);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
}