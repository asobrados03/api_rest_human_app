import * as productBookingRepo from '../repositories/product-booking.repository.js'
import * as dateUtils from '../utils/date-handler.js';

export async function getDailyAvailabilityService({ productId, date, db }) {
    const targetProductId = Number(productId);
    const formattedDate = new Date(date).toISOString().slice(0, 10);
    const dayAlias = dateUtils.getDayAliasForDate(formattedDate + 'T00:00:00Z');

    const connection = await db.getConnection();

    try {
        const [timeslotRows, coachRows, bookingRows, availabilityRows] = await Promise.all([
            productBookingRepo.fetchTimeslots(connection),
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
        console.log("DEBUG: Product ID recibido:", productId);
        console.log("DEBUG: Coaches encontrados:", coaches.length);
        console.log("DEBUG: Alias del día calculado:", dayAlias);
        console.log("DEBUG: Disponibilidad cargada para:", Object.keys(availabilityMap));

        /* ---------- Response ---------- */
        const response = [];

        for (const slot of timeslotRows) {
            const formattedSlot = slot.timeslot;

            if (coaches.length > 0 && response.length === 0) {
                console.log("DEBUG: Revisando slot:", timeslotRows[0]?.timeslot);
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

                const coachServiceId = isMorning ? coach.product_id_morning : coach.product_id_morning;
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
        console.log(`[DEBUG] Final Response: ${response.length} slots encontrados`);
        return response;

    } catch (error) {
        console.error("Error detallado en el servicio:", error);
        throw error; // Re-lanzar para que el controller maneje el 500
    } finally {
        connection.release();
    }
}

export async function reserveSessionService({ customer_id, coach_id, session_timeslot_id, service_id, product_id,
                                                start_date, status, db }) {
    const connection = await db.getConnection()

    try {
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
            product_id
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

        return { booking_id: bookingId }
    } catch (err) {
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

const APRENDE_A_ENTRENAR_PRODUCT_ID = 61

export async function getUserTrainingBookingsService({ userId, db }) {
    const connection = await db.getConnection()

    try {
        const exists = await productBookingRepo.hasTrainingBookings(
            connection,
            userId,
            APRENDE_A_ENTRENAR_PRODUCT_ID
        )

        return {
            count: exists ? 1 : 0
        }
    } finally {
        connection.release()
    }
}

// services/trainer.service.js
const APRENDE_A_ENTRENAR_FISIO_IDS = [3, 14]

export async function getTrainerReservationSlotsService({ date, shift, coachId, db }) {
    const connection = await db.getConnection()

    try {
        const dayAlias = dateUtils.getDayAliasForDate(date + 'T00:00:00Z')

        /* ---------- Disponibilidad ---------- */
        const availabilityRows = await productBookingRepo.fetchCoachAvailability(
            connection,
            coachId,
            date
        )

        const rowsForDay = availabilityRows.filter(row =>
            dateUtils.matchesDayAlias(
                dateUtils.parseDayAliases(row.days),
                dayAlias
            )
        )

        if (!rowsForDay.length) return []

        const isMorning = shift === 'morning'
        let rangeStart = null
        let rangeEnd = null
        let svcForTurn = null

        for (const row of rowsForDay) {
            const start = isMorning ? row.morning_start_time : row.afternoon_start_time
            const end = isMorning ? row.morning_end_time : row.afternoon_end_time
            const svc = isMorning ? row.service_id_morning : row.service_id_afternoon

            if (start && end && start < end && svc) {
                rangeStart = start
                rangeEnd = end
                svcForTurn = svc
                break
            }
        }

        if (!rangeStart || !rangeEnd || !svcForTurn) return []

        /* ---------- Servicio ---------- */
        const serviceName = await productBookingRepo.fetchServiceName(connection, svcForTurn)

        const isFisioONutri =
            serviceName.includes('fisio') ||
            serviceName.includes('nutri') ||
            APRENDE_A_ENTRENAR_FISIO_IDS.includes(Number(svcForTurn))

        /* ---------- Timeslots ---------- */
        const timeslots = await productBookingRepo.fetchServiceTimeslots(connection, svcForTurn)

        const filteredSlots = timeslots
            .filter(t => rangeStart <= t && t < rangeEnd)

        const validSlots = isFisioONutri
            ? filteredSlots
            : filteredSlots.filter(t => t.endsWith(':00'))

        /* ---------- Reservas ---------- */
        const bookings = await productBookingRepo.fetchCoachBookingsForRange(
            connection,
            coachId,
            date,
            rangeStart,
            rangeEnd,
            svcForTurn
        )

        const byTime = new Map(
            bookings.map(r => [
                r.time.length === 5 ? `${r.time}:00` : r.time,
                r
            ])
        )

        /* ---------- Output ---------- */
        return validSlots.map(t => {
            const hour_minutes = t.slice(0, 5)
            const r = byTime.get(t)
            const clients = []

            if (r?.clients_raw) {
                for (const piece of r.clients_raw.split('||')) {
                    const [id, name, bookingId] = piece.split(':')
                    if (id) {
                        clients.push({
                            id: Number(id),
                            name,
                            bookingId: Number(bookingId) || null
                        })
                    }
                }
            }

            return {
                id: `${date}-${hour_minutes}`,
                time: hour_minutes,
                count: Number(r?.total || 0),
                label: r?.service_name || undefined,
                clients
            }
        })
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

export async function recoverSessionService({ customer_id, coach_id, session_timeslot_id, service_id, product_id,
                                                start_date, db }) {
    const connection = await db.getConnection()

    try {
        const activeProduct = await productBookingRepo.findActiveProduct(
            connection,
            customer_id,
            product_id
        )

        if (!activeProduct) {
            const err = new Error('Producto activo no encontrado para este usuario')
            err.status = 404
            throw err
        }

        const {
            active_product_id,
            payment_method,
            payment_status
        } = activeProduct

        return await productBookingRepo.insertRecoveredBooking(connection, {
            active_product_id,
            customer_id,
            coach_id,
            session_timeslot_id,
            service_id,
            product_id,
            start_date,
            payment_status,
            payment_method
        })
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

export async function getUserServicesService({ userId, db }) {
    const connection = await db.getConnection()

    try {
        const rows = await productBookingRepo.findUserServices(connection, userId)

        return rows.map(row => ({
            id: row.service_id,
            name: row.service_name
        }))
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

export async function getPreferredCoachService({ customerId, serviceId, db }) {
    const connection = await db.getConnection()

    try {
        const coach = await productBookingRepo.findPreferredCoach(connection, customerId, serviceId)
        return coach ? coach.coach_id : null
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

export async function getUserWeeklyLimitService({ userId, targetDate, db }) {
    const connection = await db.getConnection()

    try {
        const products = await productBookingRepo.findActiveProducts(connection, userId)

        if (!products.length) {
            return []
        }

        // Agrupar por producto y quedarse con el active_product más reciente
        const latestByProduct = new Map()
        for (const r of products) {
            const productId = Number(r.product_id)
            if (!productId) continue

            const current = latestByProduct.get(productId)
            const currentTs = current?.ap_created_at
                ? new Date(current.ap_created_at).getTime()
                : -Infinity
            const candidateTs = r.ap_created_at
                ? new Date(r.ap_created_at).getTime()
                : -Infinity

            if (!current || candidateTs > currentTs) {
                latestByProduct.set(productId, r)
            }
        }

        // Semana de referencia
        const base = targetDate ? new Date(targetDate) : new Date()
        const day = base.getDay() || 7

        const monday = new Date(base)
        monday.setDate(base.getDate() - day + 1)
        monday.setHours(0, 0, 0, 0)

        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)
        sunday.setHours(23, 59, 59, 999)

        const result = []

        for (const r of latestByProduct.values()) {
            let weeklyLimit = r.total_session || 0

            // Override desde product_services si existe
            const serviceOverride = await productBookingRepo.findProductServiceOverride(
                connection,
                r.product_id
            )

            if (serviceOverride?.session != null) {
                weeklyLimit = serviceOverride.session
            }

            if (r.type_of_product === 'recurrent') {
                const used = await productBookingRepo.countWeeklyBookings(
                    connection,
                    userId,
                    r.active_product_id,
                    targetDate
                )

                result.push({
                    active_product_id: r.active_product_id,
                    product_id: r.product_id,
                    type_of_product: r.type_of_product,
                    weekly_limit: weeklyLimit,
                    total_limit: null,
                    used,
                    remaining: Math.max(0, weeklyLimit - used)
                })
            } else {
                // Bonos
                let stillValid = true

                if (r.valid_due) {
                    const validUntil = new Date(r.ap_created_at)
                    validUntil.setDate(validUntil.getDate() + Number(r.valid_due))
                    stillValid = validUntil >= new Date()
                }

                if (!stillValid) continue

                const totalLimit = r.total_session ?? weeklyLimit
                const used = await productBookingRepo.countTotalBookings(
                    connection,
                    userId,
                    r.active_product_id
                )

                const remaining =
                    totalLimit != null ? Math.max(0, totalLimit - used) : null

                result.push({
                    active_product_id: r.active_product_id,
                    product_id: r.product_id,
                    type_of_product: r.type_of_product,
                    weekly_limit: null,
                    total_limit: totalLimit,
                    used,
                    remaining
                })
            }
        }

        return result
    } finally {
        connection.release()
    }
}

export async function getUpcomingHolidays(connection) {
    const rows = await productBookingRepo.findUpcomingHolidays(connection)

    if (!rows.length) {
        return []
    }

    return rows.map(row =>
        row.date.toISOString().slice(0, 10)
    )
}
