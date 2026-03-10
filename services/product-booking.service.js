import * as productBookingRepo from '../repositories/product-booking.repository.js'
import * as dateUtils from '../utils/date-handler.js';

import logger from '../utils/pino.js';

async function ensureProductHasRemainingSessions({
    connection,
    customer_id,
    activeProduct,
    targetDate
}) {
    const weeklyLimit = Number(activeProduct.service_session_override ?? activeProduct.total_session ?? 0);
    const totalLimit = Number(activeProduct.total_session ?? activeProduct.service_session_override ?? 0);

    if (activeProduct.type_of_product === 'recurrent') {
        if (!weeklyLimit || weeklyLimit < 0) return;

        const normalizedTargetDate = new Date(targetDate).toISOString().slice(0, 10);

        const usedWeekly = await productBookingRepo.countWeeklyBookings(
            connection,
            customer_id,
            activeProduct.active_product_id,
            normalizedTargetDate
        );

        logger.info({
            active_product_id: activeProduct.active_product_id,
            start_date: normalizedTargetDate,
            usedWeekly,
            weeklyLimit,
            usage: `${usedWeekly}/${weeklyLimit}`
        }, 'Weekly booking usage check');

        if (usedWeekly >= weeklyLimit) {
            throw {
                status: 409,
                message: `Has alcanzado el máximo semanal de reservas (${weeklyLimit}) para esta suscripción`
            }
        }

        return;
    }

    if (!totalLimit || totalLimit < 0) return;

    const usedTotal = await productBookingRepo.countTotalBookings(
        connection,
        customer_id,
        activeProduct.active_product_id
    );

    if (usedTotal >= totalLimit) {
        throw {
            status: 409,
            message: `Has alcanzado el máximo de reservas (${totalLimit}) para este producto`
        }
    }
}

export async function getDailyAvailabilityService({ productId, date, db }) {
    const targetProductId = Number(productId);
    const formattedDate = new Date(date).toISOString().slice(0, 10);
    const dayAlias = dateUtils.getDayAliasForDate(formattedDate + 'T00:00:00Z');

    const connection = await db.getConnection();

    try {
        const serviceId = await productBookingRepo.getServiceMappingByProduct(connection, targetProductId);

        if (!serviceId) {
            throw new Error(`No se encontró un service_id para el producto ${targetProductId}`);
        }

        // 2. Ahora pasamos el serviceId a fetchTimeslots
        const [timeslotRows, coachRows, bookingRows, availabilityRows] = await Promise.all([
            productBookingRepo.fetchTimeslots(connection, serviceId), // <--- CAMBIO AQUÍ
            productBookingRepo.fetchCoaches(connection, targetProductId, formattedDate),
            productBookingRepo.fetchBookings(connection, targetProductId, formattedDate),
            productBookingRepo.fetchAvailability(connection, targetProductId, formattedDate)
        ]);

        /* ---------- Coaches ---------- */
        const coachMap = new Map();
        for (const row of coachRows) {
            if (!dateUtils.matchesDayAlias(dateUtils.parseDayAliases(row.days), dayAlias)) continue;

            const existing = coachMap.get(row.coach_id) || {
                coach_id: row.coach_id,
                coach_name: row.coach_name,
                product_id_morning: null,
                product_id_afternoon: null,
                capacity_morning: null,
                capacity_afternoon: null
            };

            if (row.product_id_morning != null) {
                existing.product_id_morning = Number(row.product_id_morning);
                existing.capacity_morning = Number(row.capacity_morning);
            }
            if (row.product_id_afternoon != null) {
                existing.product_id_afternoon = Number(row.product_id_afternoon);
                existing.capacity_afternoon = Number(row.capacity_afternoon);
            }
            coachMap.set(row.coach_id, existing);
        }
        const coaches = Array.from(coachMap.values());

        /* ---------- Bookings ---------- */
        const bookingMap = {};
        for (const row of bookingRows) {
            const hour = row.hour.length === 5 ? row.hour + ':00' : row.hour;
            const key = `${formattedDate}_${hour}_${row.coach_id}`;
            bookingMap[key] = Number(row.booked) || 0;
        }

        /* ---------- Availability ---------- */
        const availabilityMap = {};
        for (const row of availabilityRows) {
            if (!dateUtils.matchesDayAlias(dateUtils.parseDayAliases(row.days), dayAlias)) continue;

            const entry = availabilityMap[row.coach_id] || { morning: null, afternoon: null };

            if (row.morning_start_time && row.morning_end_time && Number(row.product_id_morning) === productId) {
                entry.morning = {
                    start: row.morning_start_time,
                    end: row.morning_end_time,
                    capacity: Number(row.capacity_morning) || 0
                };
            }
            if (row.afternoon_start_time && row.afternoon_end_time && Number(row.product_id_afternoon) === productId) {
                entry.afternoon = {
                    start: row.afternoon_start_time,
                    end: row.afternoon_end_time,
                    capacity: Number(row.capacity_afternoon) || 0
                };
            }
            availabilityMap[row.coach_id] = entry;
        }

        // Añade esto justo antes del "/* ---------- Response ---------- */"
        logger.debug({ productId }, 'DEBUG: Product ID recibido');
        logger.debug({ coachesCount: coaches.length }, 'DEBUG: Coaches encontrados');
        logger.debug({ dayAlias }, 'DEBUG: Alias del día calculado');
        logger.debug({ availabilityKeys: Object.keys(availabilityMap) }, 'DEBUG: Disponibilidad cargada para');



        /* ---------- Response ---------- */
        const response = [];

        for (const slot of timeslotRows) {
            const formattedSlot = slot.timeslot;

            if (coaches.length > 0 && response.length === 0) {
                logger.debug({ slot: timeslotRows[0]?.timeslot }, 'DEBUG: Revisando slot');
            }

            for (const coach of coaches) {
                const coachAvailability = availabilityMap[coach.coach_id];
                if (!coachAvailability) continue;

                let isMorning = false;
                let capacity = 0;
                let available = false;

                const ranges = [];
                if (coachAvailability.morning) ranges.push({ ...coachAvailability.morning, isMorning: true });
                if (coachAvailability.afternoon) ranges.push({ ...coachAvailability.afternoon, isMorning: false });

                for (const range of ranges) {
                    if (formattedSlot >= range.start && formattedSlot < range.end) {
                        available = true;
                        isMorning = range.isMorning;
                        capacity = range.capacity;
                        break;
                    }
                }

                if (!available) continue;

                const coachServiceId = isMorning ? coach.product_id_morning : coach.product_id_afternoon;
                if (Number(coachServiceId) !== targetProductId) continue;

                response.push({
                    product_id: targetProductId,
                    date: new Date(formattedDate).toISOString(),
                    hour: formattedSlot,
                    coach_id: coach.coach_id,
                    coach_name: coach.coach_name,
                    booked: 0,
                    capacity
                });
            }
        }

        // AHORA SÍ PUEDES HACER LOG DE RESPONSE
        logger.debug(`[DEBUG] Final Response: ${response.length} slots encontrados`);
        return response;

    } catch (error) {
        logger.error("Error detallado en el servicio:", error);
        throw error; // Re-lanzar para que el controller maneje el 500
    } finally {
        connection.release();
    }
}

export async function reserveSessionService({ customer_id, coach_id, session_timeslot_id, service_id, product_id,
                                                start_date, status, db }) {
    const connection = await db.getConnection()
    let inTransaction = false

    try {
        await connection.beginTransaction()
        inTransaction = true

        /* ---------- Validación duplicados ---------- */
        const existing = await productBookingRepo.findExistingBooking(
            connection,
            customer_id,
            session_timeslot_id,
            start_date
        )

        if (existing.length > 0) {
            throw {
                status: 409,
                message: 'Ya existe una reserva para este usuario y horario'
            }
        }

        /* ---------- Producto activo ---------- */
        const productoActivo = await productBookingRepo.findActiveProduct(
            connection,
            customer_id,
            product_id,
            { forUpdate: true }
        )

        if (!productoActivo) {
            throw {
                status: 404,
                message: 'Producto activo no encontrado para este usuario'
            }
        }

        const {
            active_product_id,
            payment_method,
            payment_status
        } = productoActivo

        await ensureProductHasRemainingSessions({
            connection,
            customer_id,
            activeProduct: productoActivo,
            targetDate: start_date
        });

        /* ---------- Insert booking ---------- */
        const bookingId = await productBookingRepo.insertBooking(connection, {
            active_product_id,
            customer_id,
            coach_id,
            session_timeslot_id,
            service_id,
            product_id,
            start_date,
            status,
            payment_status,
            payment_method
        })

        await connection.commit()
        inTransaction = false

        return { booking_id: bookingId }
    } catch (err) {
        if (inTransaction) {
            await connection.rollback()
            inTransaction = false
        }

        if (err.status) {
            const e = new Error(err.message)
            e.status = err.status
            throw e
        }
        throw err
    } finally {
        connection.release()
    }
}

export async function updateBookingService({ booking_id, new_coach_id, new_service_id, new_product_id,
                                               new_session_timeslot_id, new_start_date, db }) {
    const connection = await db.getConnection()

    try {
        const exists = await productBookingRepo.bookingExists(connection, booking_id)

        if (!exists) {
            const err = new Error('Reserva no encontrada')
            err.status = 404
            throw err
        }

        await productBookingRepo.updateBookingRow(connection, {
            booking_id,
            new_coach_id,
            new_service_id,
            new_product_id,
            new_session_timeslot_id,
            new_start_date
        })

    } finally {
        connection.release()
    }
}

export async function getUserBookingsService({ userId, db }) {
    const connection = await db.getConnection()
    const baseUrl = 'https://human-app.duckdns.org/api/profile_pic/'

    try {
        const rows = await productBookingRepo.fetchUserBookings(connection, userId)

        return rows.map(row => ({
            ...row,
            coach_profile_pic: row.coach_profile_pic
                ? baseUrl + row.coach_profile_pic
                : null
        }))
    } finally {
        connection.release()
    }
}

export async function cancelBookingService({ bookingId, db}) {
    const connection = await db.getConnection()

    try {
        const affectedRows = await productBookingRepo.cancelBookingRow(connection, bookingId)

        if (affectedRows === 0) {
            const err = new Error('Reserva no encontrada o ya cancelada')
            err.status = 404
            throw err
        }

        return { updated: affectedRows }
    } finally {
        connection.release()
    }
}

export async function getUserProductService({ userId, db }) {
    const connection = await db.getConnection()

    try {
        const product = await productBookingRepo.findLatestUserProduct(connection, userId)

        if (!product) {
            const err = new Error('Este usuario no tiene productos asignados')
            err.status = 404
            throw err
        }

        return product.product_id
    } finally {
        connection.release()
    }
}

export async function getTimeslotIdService({ hour, serviceId, dayOfWeek, db }) {
    const formattedHour = hour.length === 5 ? hour + ':00' : hour
    const connection = await db.getConnection()

    try {
        const timeslot = await productBookingRepo.findTimeslotByHour(connection, formattedHour, serviceId, dayOfWeek)

        if (!timeslot) {
            const err = new Error('Hora no encontrada')
            err.status = 404
            throw err
        }

        return timeslot.session_timeslot_id
    } finally {
        connection.release()
    }
}

export const getProductMappingService = async ({ productId, db }) => {
    const connection = await db.getConnection();
    try {
        const serviceId = await productBookingRepo.getServiceMappingByProduct(connection, productId);

        if (!serviceId) {
            throw new Error(`No se encontró un servicio vinculado al producto ${productId}`);
        }

        return Number(serviceId)

    } finally {
        connection.release();
    }
};

export async function getUpcomingHolidays(connection) {
    const rows = await productBookingRepo.findUpcomingHolidays(connection)

    if (!rows.length) {
        return []
    }

    return rows.map(row =>
        row.date.toISOString().slice(0, 10)
    )
}
