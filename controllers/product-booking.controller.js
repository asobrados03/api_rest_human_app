import * as productReserveService from '../services/product-booking.service.js';
import {logActivity} from "../utils/logger.js";

export function testMobileRoute(req, res) {
    res.json({ message: 'Ruta activa para el bloque: movil' })
}

export async function getDailyAvailability(req, res) {
    try {
        const { service_id, date } = req.query || {}

        if (!service_id || !date) {
            return res.status(400).json({
                error: 'Faltan parametros: service_id o date'
            })
        }

        const result = await productReserveService.getDailyAvailabilityService({
            serviceId: Number(service_id),
            date,
            db: req.db
        })

        res.json(result)
    } catch (err) {
        console.error('[ERROR] /api/mobile/daily ->', err)
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

        const result = await productReserveService.reserveSessionService({
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
            console.error('⚠️ Logging error (reserveSession):', logErr)
        }

        res.status(201).json({
            message: 'Reserva creada con éxito',
            booking_id: result.booking_id
        })
    } catch (err) {
        console.error('[ERROR] POST /api/mobile/reserve →', err)
        res.status(500).json({
            error: 'Error al insertar la reserva',
            details: err.message
        })
    }
}

export async function getUserTrainingBookings(req, res) {
    try {
        const { user_id } = req.query

        if (!user_id) {
            return res.status(400).json({ error: 'user_id is required' })
        }

        const result = await productReserveService.getUserTrainingBookingsService({
            userId: Number(user_id),
            db: req.db
        })

        res.json(result) // { count }
    } catch (err) {
        console.error('[ERROR] GET /user-training-bookings →', err)
        res.status(500).json({
            error: 'Error retrieving training bookings'
        })
    }
}

export async function getTrainerReservationSlots(req, res) {
    try {
        const { date, shift } = req.query || {}
        const coachId = req?.user_payload?.id

        if (!date || !shift || !['morning', 'afternoon'].includes(shift)) {
            return res.status(400).json({
                error: 'Parámetros requeridos: date=YYYY-MM-DD & shift=morning|afternoon'
            })
        }

        if (!coachId) {
            return res.status(401).json({ error: 'No autorizado' })
        }

        const result = await productReserveService.getTrainerReservationSlotsService({
            date,
            shift,
            coachId,
            db: req.db
        })

        res.json(result)
    } catch (err) {
        console.error('[ERROR] /api/mobile/trainer/reservations/slots →', err)
        res.status(500).json({
            error: 'Error interno',
            details: err?.message
        })
    }
}

export async function updateBooking(req, res) {
    try {
        const {
            booking_id,
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

        await productReserveService.updateBookingService({
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
            console.error('⚠️ Logging error (updateBooking):', logErr)
        }

        res.json({ message: 'Reserva actualizada correctamente' })
    } catch (err) {
        console.error('[ERROR] PUT /api/mobile/update-booking →', err)

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

        const result = await productReserveService.getUserBookingsService({
            userId: Number(user_id),
            db: req.db
        })

        res.json(result)
    } catch (err) {
        console.error('[ERROR] /api/mobile/user-bookings →', err)
        res.status(500).json({
            error: 'Error al consultar las reservas',
            details: err.message
        })
    }
}

export async function cancelBooking(req, res) {
    try {
        const bookingId = req.params.id

        if (!bookingId) {
            return res.status(400).json({ error: 'Falta el ID de la reserva' })
        }

        const result = await productReserveService.cancelBookingService({
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
            console.error('⚠️ Logging error (cancelBooking):', logErr)
        }

        res.json({
            success: true,
            updated: result.updated
        })
    } catch (err) {
        console.error('[ERROR] /booking/:id CANCEL →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({
            error: 'Error al cancelar reserva',
            details: err.message
        })
    }
}

export async function recoverSession(req, res) {
    const {
        customer_id,
        coach_id,
        session_timeslot_id,
        service_id,
        product_id,
        start_date
    } = req.body || {}

    if (
        !customer_id ||
        !coach_id ||
        !session_timeslot_id ||
        !service_id ||
        !product_id ||
        !start_date
    ) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' })
    }

    try {
        const bookingId = await productReserveService.recoverSessionService({
            customer_id,
            coach_id,
            session_timeslot_id,
            service_id,
            product_id,
            start_date,
            db: req.db
        })

        try {
            await logActivity(req, {
                subject: `Usuario ${customer_id} recuperó sesión con coach ${coach_id} el ${start_date}, active_product_id: ${active_product_id}`,
                userId: customer_id
            })
        } catch (logErr) {
            console.error('⚠️ Logging error (recoverSession):', logErr)
        }

        res.status(201).json({
            message: '✅ Sesión recuperada con éxito',
            booking_id: bookingId
        })
    } catch (err) {
        console.error('[ERROR] POST /api/mobile/recover-session →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({
            error: 'Error al recuperar la sesión',
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
        const productId = await productReserveService.getUserProductService({
            userId,
            db: req.db
        })

        res.json({ product_id: productId })
    } catch (err) {
        console.error('[ERROR] GET /user-product →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({
            error: 'Error al consultar el producto del usuario',
            details: err.message
        })
    }
}

export async function getUserServices(req, res) {
    const { user_id } = req.query

    if (!user_id) {
        return res.status(400).json({ error: 'Falta user_id' })
    }

    try {
        const services = await productReserveService.getUserServicesService({
            userId: user_id,
            db: req.db
        })

        res.json(services)
    } catch (err) {
        console.error('[ERROR] /mobile/user-services', err)
        res.status(500).json({
            error: 'Error al consultar servicios del usuario',
            details: err.message
        })
    }
}

export async function getTimeslotId(req, res) {
    const { hour } = req.query || {}

    if (!hour) {
        return res.status(400).json({ error: 'Falta el parámetro hour' })
    }

    try {
        const sessionTimeslotId = await productReserveService.getTimeslotIdService({
            hour,
            db: req.db
        })

        res.json({ session_timeslot_id: sessionTimeslotId })
    } catch (err) {
        console.error('[ERROR] GET /timeslot-id →', err)

        if (err.status) {
            return res.status(err.status).json({ error: err.message })
        }

        res.status(500).json({ error: 'Error al consultar timeslot' })
    }
}

export async function getPreferredCoach(req, res) {
    const { customer_id, service_id } = req.query || {}

    if (!customer_id || !service_id) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios' })
    }

    try {
        const coachId = await productReserveService.getPreferredCoachService({
            customerId: customer_id,
            serviceId: service_id,
            db: req.db
        })

        res.json({ coach_id: coachId })
    } catch (err) {
        console.error('[ERROR] GET /mobile/preferred-coach →', err)
        res.status(500).json({
            error: 'Error al consultar el entrenador preferido',
            details: err.message
        })
    }
}

export async function getUserWeeklyLimit(req, res) {
    const { user_id, target_date } = req.query

    if (!user_id) {
        return res.status(400).json({ error: 'Falta user_id' })
    }

    try {
        const weeklyLimits = await productReserveService.getUserWeeklyLimitService({
            userId: user_id,
            targetDate: target_date,
            db: req.db
        })

        res.json({ weekly_limits: weeklyLimits })
    } catch (err) {
        console.error('[ERROR] GET /user-weekly-limit:', err)
        res.status(500).json({
            error: 'Error al calcular límite semanal',
            details: err.message
        })
    }
}

export async function getHolidays(req, res) {
    let connection

    try {
        connection = await req.db.getConnection()

        const holidays = await productReserveService.getUpcomingHolidays(connection)

        if (!holidays.length) {
            return res.status(404).json({ error: 'No hay días festivos próximos' })
        }

        res.json(holidays)
    } catch (err) {
        console.error('[ERROR] GET /holidays →', err)
        res.status(500).json({
            error: 'Error al consultar los días festivos',
            details: err.message
        })
    } finally {
        if (connection) connection.release()
    }
}
