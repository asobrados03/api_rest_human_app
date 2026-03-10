import logger from '../utils/pino.js';
export function fetchTimeslots(connection, serviceId) {
    return connection.execute(`
        SELECT DISTINCT TIME_FORMAT(timeslot, '%H:%i:%s') AS timeslot
        FROM session_timeslots
        WHERE service_id = ?
        ORDER BY timeslot
    `, [serviceId]).then(([rows]) => rows)
}

export function fetchCoaches(connection, productId, date) {
    return connection.execute(`
    SELECT ca.coach_id,
           u.user_name AS coach_name,
           ca.days,
           ca.product_id_morning,
           ca.product_id_afternoon,
           ca.capacity_morning,
           ca.capacity_afternoon
    FROM coach_availability ca
    JOIN users u ON u.user_id = ca.coach_id
    WHERE (ca.product_id_morning = ? OR ca.product_id_afternoon = ?)
      AND (ca.activacion IS NULL OR ca.activacion <= ?)
      AND (ca.desactivacion IS NULL OR ca.desactivacion > ?)
      AND u.deleted_at IS NULL
  `, [productId, productId, date, date]).then(([rows]) => rows)
}

export function fetchBookings(connection, productId, date) {
    return connection.execute(`
    SELECT 
      b.service_id,
      DATE(b.start_date) AS date,
      TIME_FORMAT(st.timeslot, '%H:%i:%s') AS hour,
      coach.user_id AS coach_id,
      coach.user_name AS coach_name,
      COUNT(b.booking_id) AS booked,
      MAX(sv.limit) AS capacity
    FROM bookings b
    JOIN session_timeslots st ON b.session_timeslot_id = st.session_timeslot_id
    JOIN services sv ON b.service_id = sv.service_id
    JOIN users coach ON b.coach_id = coach.user_id
    WHERE 
      b.service_id = ?
      AND b.status = 'active'
      AND b.deleted_at IS NULL
      AND coach.deleted_at IS NULL
      AND DATE(b.start_date) = ?
    GROUP BY b.service_id, date, hour, coach.user_id
  `, [productId, date]).then(([rows]) => rows)
}

export function fetchAvailability(connection, productId, date) {
    return connection.execute(`
    SELECT coach_id,
           days,
           TIME_FORMAT(morning_start_time, '%H:%i:%s') AS morning_start_time,
           TIME_FORMAT(morning_end_time, '%H:%i:%s') AS morning_end_time,
           capacity_morning,
           product_id_morning,
           TIME_FORMAT(afternoon_start_time, '%H:%i:%s') AS afternoon_start_time,
           TIME_FORMAT(afternoon_end_time, '%H:%i:%s') AS afternoon_end_time,
           capacity_afternoon,
           product_id_afternoon
    FROM coach_availability
    WHERE (product_id_morning = ? OR product_id_afternoon = ?)
      AND (activacion IS NULL OR activacion <= ?)
      AND (desactivacion IS NULL OR desactivacion > ?)
  `, [productId, productId, date, date]).then(([rows]) => rows)
}

export async function findExistingBooking(
    connection,
    customerId,
    sessionTimeslotId,
    startDate
) {
    const [rows] = await connection.execute(`
    SELECT booking_id
    FROM bookings
    WHERE customer_id = ?
      AND session_timeslot_id = ?
      AND DATE(start_date) = DATE(?)
      AND status = 'active'
  `, [customerId, sessionTimeslotId, startDate])

    return rows
}

export async function findActiveProduct(
    connection,
    customerId,
    productId,
    { forUpdate = false } = {}
) {
    const [[row]] = await connection.execute(`
    SELECT
      ap.active_product_id,
      ap.payment_method,
      ap.payment_status,
      ap.created_at AS active_product_created_at,
      p.type_of_product,
      p.total_session,
      ps.session AS service_session_override
    FROM active_products ap
    JOIN products p ON ap.product_id = p.product_id
    LEFT JOIN product_services ps ON ap.product_id = ps.product_id
    WHERE customer_id = ?
      AND ap.product_id = ?
      AND (ap.expiry_date IS NULL OR ap.expiry_date >= CURDATE())
      AND ap.deleted_at IS NULL
      AND LOWER(ap.active_product_status) IN ('booked', 'active', 'paid')
    ORDER BY ap.created_at DESC
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE' : ''}
  `, [customerId, productId])

    return row || null
}

export async function insertBooking(connection, data) {
    const [
        result
    ] = await connection.execute(`
    INSERT INTO bookings (
      active_product_id,
      customer_id,
      coach_id,
      session_timeslot_id,
      service_id,
      product_id,
      start_date,
      status,
      payment_status,
      payment_method,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
        data.active_product_id,
        data.customer_id,
        data.coach_id,
        data.session_timeslot_id,
        data.service_id,
        data.product_id,
        data.start_date,
        data.status,
        data.payment_status,
        data.payment_method,
        new Date()
    ])

    return result.insertId
}

export async function bookingExists(connection, bookingId) {
    const [rows] = await connection.execute(
        `
    SELECT booking_id
    FROM bookings
    WHERE booking_id = ?
    `,
        [bookingId]
    )

    return rows.length > 0
}

export async function updateBookingRow(connection, data) {
    await connection.execute(
        `
    UPDATE bookings
    SET coach_id = ?,
        service_id = ?,
        product_id = ?,
        session_timeslot_id = ?,
        start_date = ?
    WHERE booking_id = ?
    `,
        [
            data.new_coach_id,
            data.new_service_id,
            data.new_product_id,
            data.new_session_timeslot_id,
            data.new_start_date,
            data.booking_id
        ]
    )
}

export async function fetchUserBookings(connection, userId) {
    const [rows] = await connection.execute(
        `
            SELECT
                b.booking_id AS id,
                DATE(b.start_date) AS date,
                TIME_FORMAT(st.timeslot, '%H:%i:%s') AS hour,
                sv.service_name AS service,
                sv.service_id AS service_id,
                p.product_name AS product,          -- <--- Nuevo campo
                coach.user_name AS coach_name,
                coach.profile_pic AS coach_profile_pic,
                b.product_id AS product_id
            FROM bookings b
                JOIN session_timeslots st ON b.session_timeslot_id = st.session_timeslot_id
                JOIN services sv ON b.service_id = sv.service_id
                JOIN products p ON b.product_id = p.product_id -- <--- JOIN con la tabla de productos
                JOIN users coach ON b.coach_id = coach.user_id
            WHERE
                b.customer_id = ?
              AND b.status = 'active'
              AND b.deleted_at IS NULL        -- Recomendado añadir esto si usas soft delete
            ORDER BY b.start_date, st.timeslot
        `,
        [userId]
    )

    return rows
}

export async function cancelBookingRow(connection, bookingId) {
    const [result] = await connection.execute(
        `
    UPDATE bookings
    SET status = 'canceled',
        updated_at = NOW()
    WHERE booking_id = ?
    `,
        [bookingId]
    )

    return result.affectedRows
}

export async function findLatestUserProduct(connection, userId) {
    const [rows] = await connection.execute(
        `
    SELECT product_id
    FROM active_products
    WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT 1
    `,
        [userId]
    )

    return rows.length ? rows[0] : null
}

export async function findTimeslotByHour(connection, formattedHour, serviceId, dayOfWeek) {
    const [rows] = await connection.execute(`
        SELECT session_timeslot_id
        FROM session_timeslots
        WHERE TIME_FORMAT(timeslot, '%H:%i:%s') = ?
          AND service_id = ?
          AND day_of_week = ?
    `, [formattedHour, serviceId, dayOfWeek])

    return rows.length ? rows[0] : null
}

export async function countWeeklyBookings(
    connection,
    userId,
    activeProductId,
    targetDate
) {
    logger.info({ userId, activeProductId, targetDate }, 'Counting weekly bookings for user');
    const [rows] = await connection.execute(`
    SELECT COUNT(*) AS used
    FROM bookings
    WHERE customer_id = ?
      AND active_product_id = ?
      AND status = 'active'
      AND deleted_at IS NULL
      AND YEARWEEK(start_date, 1) = YEARWEEK(?, 1)
  `, [userId, activeProductId, targetDate])

    return rows[0]?.used || 0
}

export async function countTotalBookings(
    connection,
    userId,
    activeProductId
) {
    const [rows] = await connection.execute(`
    SELECT COUNT(*) AS used
    FROM bookings
    WHERE customer_id = ?
      AND active_product_id = ?
      AND status = 'active'
      AND deleted_at IS NULL
  `, [userId, activeProductId])

    return rows[0]?.used || 0
}

export async function findUpcomingHolidays(connection) {
    const [rows] = await connection.execute(`
    SELECT date
    FROM holidays
    WHERE date >= CURDATE()
    ORDER BY date ASC
  `)

    return rows
}

export const getServiceMappingByProduct = async (connection, productId) => {
    const [rows] = await connection.execute(`
    SELECT service_id 
    FROM product_services 
    WHERE product_id = ? 
    LIMIT 1
  `, [productId]);

    return rows.length > 0 ? rows[0].service_id : null;
};
