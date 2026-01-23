export async function findUserById(connection, userId) {
    const [rows] = await connection.execute(
        `SELECT
             u.user_id       AS id,
             u.user_name     AS fullName,
             u.email,
             u.phone,
             u.sex,
             DATE_FORMAT(u.date_of_birth, '%d/%m/%Y') AS dateOfBirth,
             u.postal_code   AS postcode,
             u.address       AS postAddress,
             u.dni,
             u.profile_pic   AS profilePictureName
         FROM users u
         WHERE u.user_id = ? AND u.deleted_at IS NULL
         LIMIT 1`,
        [userId]
    );
    return rows[0];
}

export async function findUserByEmail(connection, email) {
    const [rows] = await connection.execute(
        "SELECT user_id FROM users WHERE email = ?",
        [email]
    );
    return rows[0];
}

export async function findAllSubscriptions(connection) {
    const [rows] = await connection.execute(
        `SELECT 
         s.id, s.user_id, u.user_name, u.phone, s.payerref, s.paymentmethod,
         s.amount_minor, s.currency, s.interval_months, s.next_charge_at, 
         s.status, s.last_result, s.updated_at, s.order_prefix
       FROM subscriptions s
       JOIN users u ON u.user_id = s.user_id
       ORDER BY s.id DESC`
    );
    return rows;
}

export async function findSubscriptionHistory(connection) {
    const [rows] = await connection.execute(
        `SELECT 
        h.id, u.user_name, u.phone, h.product_id, h.amount_minor,
        h.currency, h.month_year, h.paid_date, h.delay_days,
        h.method, h.status, h.pasref, h.orderid, h.message
      FROM subscription_history h
      JOIN users u ON u.user_id = h.user_id
      ORDER BY h.month_year DESC, h.id DESC`
    );
    return rows;
}

export async function findProfilePicName(connection, userId) {
    const [rows] = await connection.execute(
        'SELECT profile_pic FROM users WHERE user_id = ?',
        [userId]
    );
    return rows[0] ? rows[0].profile_pic : null;
}

export async function updateUserDynamic(connection, userId, setClauses, values) {
    const sqlUpdate = `
        UPDATE users
        SET ${setClauses.join(', ')}
        WHERE user_id = ?`;

    // values ya debe contener los valores de setClauses
    await connection.execute(sqlUpdate, [...values, userId]);
}

export async function deleteUserByEmail(connection, email) {
    const [result] = await connection.execute(
        "DELETE FROM users WHERE email = ?",
        [email]
    );
    return result.affectedRows;
}

export async function findAllCoaches(connection) {
    const sql = `
        SELECT u.user_id       AS id,
               u.user_name     AS name,
               u.profile_pic   AS profile_photo,
               se.service_name AS service
        FROM users u
        LEFT JOIN services se ON u.service_id = se.service_id
        WHERE u.type = 'coach'
          AND u.deleted_at IS NULL
        ORDER BY u.created_at DESC`;
    const [rows] = await connection.query(sql);
    return rows;
}

export async function findServiceByName(connection, serviceName) {
    const [rows] = await connection.query(
        `SELECT service_id FROM services WHERE service_name = ? AND deleted_at IS NULL LIMIT 1`,
        [serviceName]
    );
    return rows[0];
}

export async function findPrimaryServiceByName(connection, serviceName) {
    const [rows] = await connection.query(
        `SELECT primary_service_id FROM primary_service WHERE name = ? AND deleted_at IS NULL LIMIT 1`,
        [serviceName]
    );
    return rows[0];
}

export async function findPreferredCoachRelation(connection, customerId, serviceId) {
    const [rows] = await connection.query(
        `SELECT preferred_coach_id, coach_id
         FROM preferred_coach
         WHERE customer_id = ? AND service_id = ?`,
        [customerId, serviceId]
    );
    return rows[0];
}

export async function updatePreferredCoach(connection, id, coachId) {
    await connection.query(
        `UPDATE preferred_coach SET coach_id = ?, updated_at = CURRENT_TIMESTAMP() WHERE preferred_coach_id = ?`,
        [coachId, id]
    );
}

export async function createPreferredCoach(connection, serviceId, customerId, coachId) {
    await connection.query(
        `INSERT INTO preferred_coach (service_id, customer_id, coach_id) VALUES (?, ?, ?)`,
        [serviceId, customerId, coachId]
    );
}

export async function findPreferredCoachByCustomer(connection, customerId) {
    const [rows] = await connection.query(
        `SELECT coach_id FROM preferred_coach WHERE customer_id = ? LIMIT 1`,
        [customerId]
    );
    return rows[0];
}

export async function removeUserProfilePic(connection, userId) {
    await connection.execute(
        'UPDATE users SET profile_pic = NULL, updated_at = NOW() WHERE user_id = ?',
        [userId]
    );
}

export async function getStatsLastMonth(connection, userId) {
    const monthWindow = `
    b.start_date BETWEEN
      DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
      AND LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
    `;
    const [rows] = await connection.query(`
        SELECT b.service_id, s.service_name AS service_name, COUNT(*) AS total
        FROM bookings b
        JOIN services s ON s.service_id = b.service_id
        WHERE b.customer_id = ? AND ${monthWindow}
          AND b.deleted_at IS NULL AND b.status = 'active'
        GROUP BY b.service_id, s.service_name
    `, [userId]);
    return rows;
}

export async function getStatsTopCoach(connection, userId) {
    const [rows] = await connection.query(`
        SELECT x.service_id, x.service_name, x.coach_name, x.cnt
        FROM (
             SELECT b.service_id, s.service_name AS service_name, u.user_name AS coach_name,
                    COUNT(*) AS cnt,
                    ROW_NUMBER() OVER (PARTITION BY b.service_id ORDER BY COUNT(*) DESC) AS rn
             FROM bookings b
             JOIN users u ON u.user_id = b.coach_id
             JOIN services s ON s.service_id = b.service_id
             WHERE b.customer_id = ? AND u.deleted_at IS NULL
             GROUP BY b.service_id, s.service_name, u.user_name
        ) x WHERE x.rn = 1
    `, [userId]);
    return rows;
}

export async function getStatsPending(connection, userId) {
    const [rows] = await connection.query(`
        SELECT b.service_id, s.service_name AS service_name, COUNT(*) AS total
        FROM bookings b
        JOIN services s ON s.service_id = b.service_id
        WHERE b.customer_id = ? AND DATE(b.start_date) >= CURDATE()
          AND b.deleted_at IS NULL AND b.status <> 'canceled'
        GROUP BY b.service_id, s.service_name
    `, [userId]);
    return rows;
}

export async function findValidCouponByCode(connection, couponCode) {
    const [[coupon]] = await connection.query(
        `SELECT coupon_id, customer_ids
         FROM coupons
        WHERE coupon_code = ?
          AND deleted_at  IS NULL
          AND start_date <= CURDATE()
          AND expiry_date>= CURDATE()
        LIMIT 1`,
        [couponCode]
    );
    return coupon;
}

export async function findCouponByCodeSimple(connection, couponCode) {
    const [[coupon]] = await connection.query(
        `SELECT coupon_id FROM coupons WHERE coupon_code = ? AND deleted_at IS NULL LIMIT 1`,
        [couponCode]
    );
    return coupon;
}

export async function getUserCouponsIds(connection, userId) {
    const [[u]] = await connection.query(`SELECT coupons_ids FROM users WHERE user_id = ? LIMIT 1`, [userId]);
    return u; // Retorna objeto { coupons_ids: '...' } o undefined
}

export async function updateUserCouponsIds(connection, userId, csvIds) {
    await connection.query(
        `UPDATE users SET coupons_ids = ?, updated_at = NOW() WHERE user_id = ?`,
        [csvIds, userId]
    );
}

export async function findCouponsDetails(connection, idsArr, userId) {
    const placeholders = idsArr.map(() => "?").join(",");
    const params = [...idsArr, userId];

    const [rows] = await connection.query(
        `SELECT
          coupon_id      AS id,
          coupon_code    AS code,
          discount,
          is_percentage  AS isPercentage,
          DATE_FORMAT(start_date,  '%Y-%m-%d') AS startDate,
          DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate,
          product_ids,
          customer_ids
        FROM coupons
        WHERE coupon_id IN (${placeholders})
          AND deleted_at IS NULL
          AND start_date <= CURDATE()
          AND expiry_date >= CURDATE()
          AND (customer_ids IS NULL OR FIND_IN_SET(?, customer_ids))`,
        params
    );
    return rows;
}

export async function findUserDocuments(connection, userId) {
    const [rows] = await connection.execute(
        'SELECT id, filename, original_name, created_at FROM user_documents WHERE user_id = ?',
        [userId]
    );
    return rows;
}

export async function createUserDocument(connection, userId, filename, originalName) {
    await connection.execute(
        'INSERT INTO user_documents (user_id, filename, original_name) VALUES (?, ?, ?)',
        [userId, filename, originalName]
    );
}

export async function findDocumentByFilename(connection, filename, userId) {
    const [rows] = await connection.execute(
        'SELECT * FROM user_documents WHERE filename = ? AND user_id = ?',
        [filename, userId]
    );
    return rows[0];
}

export async function deleteDocumentRecord(connection, filename, userId) {
    await connection.execute(
        'DELETE FROM user_documents WHERE filename = ? AND user_id = ?',
        [filename, userId]
    );
}

export async function findEwalletBalance(connection, userId) {
    const [rows] = await connection.execute(
        'SELECT balance FROM e_wallet WHERE user_id = ?',
        [userId]
    );
    return rows[0];
}

export async function findEwalletTransactions(connection, userId) {
    const [rows] = await connection.execute(
        `
        SELECT 
            l.amount,
            l.balance,
            l.transaction_title AS description,
            l.transaction_type AS type,
            l.created_at,
            p.product_name
        FROM e_wallet l
        LEFT JOIN products p ON l.product_id = p.product_id
        WHERE l.user_id = ?
        ORDER BY l.created_at DESC
        LIMIT 10
        `,
        [userId]
    );

    return rows;
}

export async function findSavedPaymentMethod(connection, userId) {
    const [rows] = await connection.execute(
        'SELECT id FROM saved_payment_methods WHERE user_id = ? AND status = "active" LIMIT 1',
        [userId]
    );
    return rows[0];
}