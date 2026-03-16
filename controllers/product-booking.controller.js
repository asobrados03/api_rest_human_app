import * as productBookingService from '../services/product-booking.service.js';
import {logActivity} from "../utils/logger.js";

import logger from '../utils/pino.js';
export function testMobileRoute(req, res) {
    res.json({ message: 'Ruta activa para el bloque: movil' })
}

export async function getDailyAvailability(req, res) {
    try {
        const { product_id, date } = req.query || {}

        if (!product_id || !date) {
            return res.status(400).json({
                error: 'Faltan parametros: product_id o date'
            })
        }

        const result = await productBookingService.getDailyAvailabilityService({
            productId: Number(product_id),
            date,
            db: req.db
        })

        res.json(result)
    } catch (err) {
        logger.error({ err }, '[ERROR] /api/mobile/daily ->')
        res.status(500).json({
            error: 'Error al consultar disponibilidad diaria',
            details: err.message
        })
    }
}

export async function reserveSession(req, res) {
    try {
        const {
            customer_id,
            coach_id,
            session_timeslot_id,
            service_id,
            product_id,
            start_date,
            status = 'active'
        } = req.body || {}

        if (!customer_id || !coach_id || !session_timeslot_id || !service_id || !product_id || !start_date) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' })
        }

        const result = await productBookingService.reserveSessionService({
            customer_id,
            coach_id,
            session_timeslot_id,
            service_id,
            product_id,
            start_date,
            status,
            db: req.db
        })

        try {
            await logActivity(req, {
                subject: `Usuario ${customer_id} reservó sesión con coach ${coach_id} el 
                ${start_date}, product_id: ${product_id}`,
                userId: customer_id
            })
        } catch (logErr) {
            logger.error({ logErr }, '⚠️ Logging error (reserveSession):')
        }

        res.status(201).json({
            message: 'Reserva creada con éxito',
            booking_id: result.booking_id
        })
    } catch (err) {
        const statusCode = Number(err?.status) || 500
        const errorMessage = err?.message || 'Error al insertar la reserva'

        logger.error({ err, statusCode }, '[ERROR] POST /api/mobile/reserve →')

        if (statusCode >= 400 && statusCode < 500) {
            return res.status(statusCode).json({
                error: errorMessage
            })
        }

        res.status(500).json({
            error: 'Error al insertar la reserva',
            details: errorMessage
        })
    }
}

export async function updateBooking(req, res) {
    try {
        const { bookingId: booking_id } = req.params || {}
        const {
            new_coach_id,
            new_service_id,
            new_product_id,
            new_session_timeslot_id,
            new_start_date
        } = req.body || {}

        if (
            !booking_id ||
            !new_coach_id ||
            !new_service_id ||
            !new_product_id ||
            !new_session_timeslot_id ||
            !new_start_date
        ) {
            return res.status(400).json({ error: 'Faltan parámetros obligatorios' })
        }

        await productBookingService.updateBookingService({
            booking_id,
            new_coach_id,
            new_service_id,
            new_product_id,
            new_session_timeslot_id,
            new_start_date,
            db: req.db,
            req
        })

        try {
            await logActivity(req, {
                subject: `Reserva ${booking_id} actualizada: nuevo coach ${new_coach_id}, nueva fecha ${new_start_date}`,
                userId: req.user?.id || 0
            })
        } catch (logErr) {
            logger.error({ logErr }, '⚠️ Logging error (updateBooking):')
        }

        res.json({ message: 'Reserva actualizada correctamente' })
    } catch (err) {
        logger.error({ err }, '[ERROR] PATCH /api/mobile/bookings/:bookingId →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({
            error: 'Error al actualizar la reserva',
            details: err.message
        })
    }
}

export async function getUserBookings(req, res) {
    try {
        const { user_id } = req.query || {}

        if (!user_id) {
            return res.status(400).json({ error: 'Falta el parámetro user_id' })
        }

        const result = await productBookingService.getUserBookingsService({
            userId: Number(user_id),
            db: req.db
        })

        res.json(result)
    } catch (err) {
        logger.error({ err }, '[ERROR] /api/mobile/user-bookings →')
        res.status(500).json({
            error: 'Error al consultar las reservas',
            details: err.message
        })
    }
}

export async function cancelBooking(req, res) {
    try {
        const { bookingId } = req.params

        if (!bookingId) {
            return res.status(400).json({ error: 'Falta el ID de la reserva' })
        }

        const result = await productBookingService.cancelBookingService({
            bookingId,
            db: req.db,
            req
        })

        try {
            await logActivity(req, {
                subject: `Reserva ${bookingId} fue cancelada por el usuario ${req.user?.id || 'sistema'}`,
                userId: req.user?.id || 0
            })
        } catch (logErr) {
            logger.error({ logErr }, '⚠️ Logging error (cancelBooking):')
        }

        res.json({
            success: true,
            updated: result.updated
        })
    } catch (err) {
        logger.error({ err }, '[ERROR] DELETE /bookings/:bookingId CANCEL →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({
            error: 'Error al cancelar reserva',
            details: err.message
        })
    }
}

export async function getUserProduct(req, res) {
    const userId = parseInt(req.query.user_id, 10)

    if (isNaN(userId)) {
        return res.status(400).json({
            error: 'Parámetro user_id inválido o ausente'
        })
    }

    try {
        const productId = await productBookingService.getUserProductService({
            userId,
            db: req.db
        })

        res.json({ product_id: productId })
    } catch (err) {
        logger.error({ err }, '[ERROR] GET /user-product →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({
            error: 'Error al consultar el producto del usuario',
            details: err.message
        })
    }
}

export async function getTimeslotId(req, res) {
    const { hour, service_id : serviceId, day_of_week: dayOfWeek } = req.query || {}

    if (!hour) {
        return res.status(400).json({ error: 'Falta el parámetro hour' })
    }

    try {
        const sessionTimeslotId = await productBookingService.getTimeslotIdService({
            hour,
            serviceId,
            dayOfWeek,
            db: req.db
        })

        res.json({ session_timeslot_id: sessionTimeslotId })
    } catch (err) {
        logger.error({ err }, '[ERROR] GET /timeslot-id →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({ error: 'Error al consultar timeslot' })
    }
}

export async function getServiceIdForProduct(req, res) {
    try {
        const { productId } = req.params;
        const db = req.db; // Asumiendo que pasas el pool de DB por el request

        if (!productId) {
            return res.status(400).json({ error: 'El ID del producto es requerido' });
        }

        const serviceId = await productBookingService.getProductMappingService({
            productId,
            db
        });

        return res.status(200).json(serviceId);
    } catch (error) {
        logger.error(`❌ Error en getProductMapping: ${error.message}`);
        return res.status(500).json({
            error: 'Error interno al obtener el mapeo del producto',
            details: error.message
        });
    }
}

export async function getHolidays(req, res) {
    let connection

    try {
        connection = await req.db.getConnection()

        const holidays = await productBookingService.getUpcomingHolidays(connection)

        if (!holidays.length) {
            return res.status(404).json({ error: 'No hay días festivos próximos' })
        }

        res.json(holidays)
    } catch (err) {
        logger.error({ err }, '[ERROR] GET /holidays →', err)
        res.status(500).json({
            error: 'Error al consultar los días festivos',
            details: err.message
        })
    } finally {
        if (connection) connection.release()
    }
}
