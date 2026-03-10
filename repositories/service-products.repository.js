export const getServices = async (connection) => {
    const [rows] = await connection.query(`
    SELECT service_id AS id, service_name AS name, service_image AS image
    FROM services WHERE deleted_at IS NULL
  `);
    return rows;
};

export const getProductsByServiceId = async (connection, serviceId) => {
    const [rows] = await connection.query(`
    SELECT p.product_id AS id, p.product_name_es AS name, p.description_es AS description,
           p.sell_price AS price, p.product_image AS image, p.type_of_product, ps.session
    FROM products p
    JOIN product_services ps ON p.product_id = ps.product_id
    WHERE ps.service_id = ? AND p.deleted_at IS NULL
    GROUP BY p.product_id
  `, [serviceId]);
    return rows;
};

export const getActiveProductsByUserId = async (connection, userId) => {
    const [rows] = await connection.execute(`
        SELECT DISTINCT
            p.product_id AS id, p.product_name_es AS name, p.description_es AS description,
            ap.total_amount AS price, p.product_image AS image, ps.service_id AS service_id,
            ap.expiry_date, p.type_of_product, ap.centro AS centro,
            ap.payment_method, ap.payment_status, ap.active_product_status,
            -- Traemos los ID de Stripe
            s.subscription_id AS stripe_subscription_id,
            st.stripe_charge_id AS stripe_payment_intent_id
        FROM active_products ap
                 JOIN products p ON ap.product_id = p.product_id
                 LEFT JOIN product_services ps ON p.product_id = ps.product_id
                 LEFT JOIN subscriptions s ON ap.product_id = JSON_UNQUOTE(JSON_EXTRACT(s.metadata, '$.product_id'))
            AND ap.customer_id = s.user_id
            AND s.status = 'active'
             -- Join con transacciones de pago único
            LEFT JOIN stripe_transactions st ON ap.product_id = st.product_id
            AND ap.customer_id = st.customer_id
        WHERE ap.customer_id = ?
          AND ap.deleted_at IS NULL AND p.deleted_at IS NULL
          AND (ap.expiry_date IS NULL OR ap.expiry_date >= CURDATE())
          AND LOWER(ap.active_product_status) IN ('booked','active','paid')
          AND (ap.payment_status = 'paid' OR (ap.payment_method = 'bank_transfer' AND ap.payment_status = 'unpaid'))
    `, [userId]);
    return rows;
};

export const findActiveProduct = async (connection, userId, productId) => {
    const [rows] = await connection.execute(`
    SELECT * FROM active_products
    WHERE customer_id = ? AND product_id = ?
      AND (expiry_date IS NULL OR expiry_date >= CURDATE())
      AND active_product_status IN ('booked','active','paid')
      AND deleted_at IS NULL
  `, [userId, productId]);
    return rows[0];
};

export const getProductById = async (connection, productId) => {
    const [rows] = await connection.execute(`
    SELECT product_id, sell_price, valid_due, type_of_product, centro
    FROM products WHERE product_id = ?
  `, [productId]);
    return rows[0];
};

export const getCouponByCode = async (connection, code) => {
    const [rows] = await connection.execute(`
    SELECT coupon_id, discount, is_percentage
    FROM coupons WHERE coupon_code = ? AND deleted_at IS NULL
  `, [code]);
    return rows[0];
};

export const getCouponDiscount = async (connection, couponCode) => {
    const [rows] = await connection.execute(`
    SELECT discount, is_percentage, expiry_date FROM coupons WHERE coupon_code = ? AND deleted_at IS NULL
  `, [couponCode]);
    return rows[0];
};

export const countInvoicesByPrefix = async (connection, prefix) => {
    const [[{ count }]] = await connection.execute(`
    SELECT COUNT(*) AS count FROM active_products WHERE invoice_number LIKE ?
  `, [prefix]);
    return count;
};

export const getLatestWalletBalance = async (connection, userId) => {
    const [[wallet]] = await connection.execute(`
    SELECT balance FROM e_wallet WHERE user_id = ? ORDER BY e_wallet_id DESC LIMIT 1
  `, [userId]);
    return wallet ? wallet.balance : 0;
};

export const createWalletTransaction = async (connection, { userId, productId, amount, newBalance }) => {
    const transactionCode = `TXN_${Date.now()}_${crypto.randomUUID()}`;
    const transactionTitle = `Compra de producto ID: ${productId}`;

    await connection.execute(`
        INSERT INTO e_wallet (e_wallet_tran_code, user_id, product_id, amount, balance, transaction_title, transaction_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'purchase', NOW())
    `, [transactionCode, userId, productId, amount, newBalance, transactionTitle]);
};

export const createActiveProduct = async (connection, data) => {
    const { userId, productId, price, discount, totalAmount, paymentMethod, validDays, couponId, invoiceNumber, centro } = data;
    const [result] = await connection.execute(`
    INSERT INTO active_products (
      customer_id, product_id, amount, discount, total_amount, 
      payment_method, payment_status, purchase_date, expiry_date, 
      active_product_status, coupon_id, invoice_number, created_at, centro
    ) VALUES (?, ?, ?, ?, ?, ?, 'paid', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'booked', ?, ?, NOW(), ?)
  `, [userId, productId, price, discount, totalAmount, paymentMethod, validDays, couponId, invoiceNumber, centro]);
    return result;
};

export const createSubscription = async (connection, { userId, totalAmount, subscription_id }) => {
    await connection.execute(`
    INSERT INTO subscriptions (user_id, amount_minor, status, subscription_id, created_at)
    VALUES (?, ?, 'active', ?, NOW())
  `, [userId, Math.round(totalAmount * 100), subscription_id]);
};

export const cancelActiveProduct = async (
    connection,
    { userId, productId, lastDay }
) => {

    const [result] = await connection.execute(`
        UPDATE active_products
        SET expiry_date = ?,
            updated_at = NOW(),
            active_product_status = 'canceled'
        WHERE customer_id = ?
          AND product_id = ?
          AND deleted_at IS NULL
          AND active_product_status != 'canceled'
    `, [lastDay, userId, productId]);

    if (result.affectedRows === 0) {
        // No había nada activo o ya estaba cancelado
        return { alreadyCanceled: true };
    }

    return { canceled: true };
};

export const cancelSubscription = async (connection, { userId, subscription_id }) => {
    await connection.execute(`
    UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
    WHERE user_id = ? AND subscription_id = ?
  `, [userId, subscription_id]);
};

export const getActiveProductDetail = async (connection, userId, productId) => {
    const [[producto]] = await connection.execute(`
    SELECT ap.purchase_date AS created_at, ap.expiry_date, ap.total_amount, ap.centro,
           p.product_name_es AS name, p.product_image AS image, p.description_es AS description,
           p.type_of_product, p.total_session
    FROM active_products ap
    JOIN products p ON ap.product_id = p.product_id
    WHERE ap.customer_id = ? AND ap.product_id = ? AND ap.deleted_at IS NULL
    ORDER BY ap.created_at DESC LIMIT 1
  `, [userId, productId]);
    return producto;
};

export async function getProductDetailById(connection, productId) {
    const sql = `
        SELECT
            product_id      AS id,
            product_name    AS name,
            description_es  AS description,
            price,
            product_image   AS image,
            total_session   AS session,
            type_of_product,
            price_id
        FROM products
        WHERE product_id = ?
          AND deleted_at IS NULL
        LIMIT 1
    `;

    const [rows] = await connection.execute(sql, [productId]);
    return rows.length ? rows[0] : null;
}

export const getProductServices = async (connection, productId) => {
    const [services] = await connection.execute(`
    SELECT DISTINCT s.service_id AS id, s.service_name AS name, s.service_image AS image
    FROM product_services ps
    JOIN services s ON s.service_id = ps.service_id
    WHERE ps.product_id = ? AND s.deleted_at IS NULL
  `, [productId]);
    return services;
};

export const updateActiveProductExpiry = async (connection, id, newDueDate) => {
    const query = "UPDATE active_products SET due_date = ?, status = 'active' WHERE id = ?";
    return await connection.execute(query, [newDueDate, id]);
};