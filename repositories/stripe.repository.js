/**
 * Actualizar el stripe_customer_id en la tabla users
 */
export async function updateUserStripeCustomerId(connection, userId, stripeCustomerId) {
    const query = `
  UPDATE users 
  SET stripe_customer_id = ?, updated_at = NOW() 
  WHERE user_id = ?
`;
    const [result] = await connection.execute(query, [stripeCustomerId, userId]);
    return result;
}

/**
 * Obtener usuario por ID
 */
export async function getUserById(connection, userId) {
    const query = `
  SELECT user_id, user_name, email, phone, stripe_customer_id 
  FROM users 
  WHERE user_id = ? AND deleted_at IS NULL
`;
    const [rows] = await connection.execute(query, [userId]);
    return rows[0];
}

// ==================== TRANSACCIONES ====================

/**
 * Crear una transacción de Stripe
 */
export async function createStripeTransaction(connection, data) {
    const query = `
  INSERT INTO stripe_transactions (
    product_id, 
    customer_id, 
    amount, 
    stripe_charge_id, 
    stripe_card_id,
    created_at
  ) VALUES (?, ?, ?, ?, ?, NOW())
`;
    const [result] = await connection.execute(query, [
        data.product_id,
        data.customer_id,
        data.amount,
        data.stripe_charge_id,
        data.stripe_card_id
    ]);
    return result.insertId;
}

/**
 * Obtener transacción por ID
 */
export async function getTransactionById(connection, transactionId) {
    const query = `
  SELECT * FROM stripe_transactions 
  WHERE stripe_transaction_id = ?
`;
    const [rows] = await connection.execute(query, [transactionId]);
    return rows[0];
}

/**
 * Obtener transacciones por usuario
 */
export async function getTransactionsByCustomerId(connection, customerId) {
    const query = `
  SELECT st.*, p.product_name, p.product_name_es
  FROM stripe_transactions st
  LEFT JOIN products p ON st.product_id = p.product_id
  WHERE st.customer_id = ?
  ORDER BY st.created_at DESC
`;
    const [rows] = await connection.execute(query, [customerId]);
    return rows;
}

// ==================== PRODUCTOS ACTIVOS ====================

/**
 * Crear un producto activo (compra)
 */
export async function createActiveProduct(connection, data) {
    const query = `
  INSERT INTO active_products (
    product_id,
    invoice_number,
    customer_id,
    group_id,
    purchase_date,
    expiry_date,
    amount,
    discount,
    total_amount,
    coupon_id,
    payment_status,
    payment_method,
    stripe_transaction_id,
    card_id,
    created_at,
    centro
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
`;
    const [result] = await connection.execute(query, [
        data.product_id,
        data.invoice_number,
        data.customer_id,
        data.group_id || null,
        data.purchase_date,
        data.expiry_date,
        data.amount,
        data.discount,
        data.total_amount,
        data.coupon_id || null,
        data.payment_status,
        data.payment_method,
        data.stripe_transaction_id || null,
        data.card_id || null,
        data.centro || null
    ]);
    return result.insertId;
}

/**
 * Actualizar el estado de pago de un producto activo
 */
export async function updateActiveProductPaymentStatus(connection, activeProductId, paymentStatus) {
    const query = `
  UPDATE active_products 
  SET payment_status = ?, updated_at = NOW() 
  WHERE active_product_id = ?
`;
    const [result] = await connection.execute(query, [paymentStatus, activeProductId]);
    return result;
}

/**
 * Obtener producto activo por ID
 */
export async function getActiveProductById(connection, activeProductId) {
    const query = `
  SELECT ap.*, p.product_name, p.product_name_es, p.type_of_product
  FROM active_products ap
  LEFT JOIN products p ON ap.product_id = p.product_id
  WHERE ap.active_product_id = ? AND ap.deleted_at IS NULL
`;
    const [rows] = await connection.execute(query, [activeProductId]);
    return rows[0];
}

// ==================== PRODUCTOS ====================

/**
 * Obtener producto por ID
 */
export async function getProductById(connection, productId) {
    const query = `
  SELECT * FROM products 
  WHERE product_id = ? AND deleted_at IS NULL
`;
    const [rows] = await connection.execute(query, [productId]);
    return rows[0];
}

// ==================== MÉTODOS DE PAGO GUARDADOS ====================

/**
 * Guardar tarjeta (método de pago) tokenizada
 */
export async function savePaymentMethod(connection, data, userId) {
    const query = `
        INSERT INTO saved_payment_methods (
            user_id,
            payment_method_id,
            customer_id,
            brand,
            last4,
            exp_month,
            exp_year,
            card_type,
            fingerprint,
            company,
            is_default,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await connection.execute(query, [
        userId,
        data.payment_method_id,
        data.customer_id,
        data.brand,
        data.last4,
        data.exp_month,
        data.exp_year,
        data.card_type || null,
        data.fingerprint || null,
        data.company || 'SPORT',
        data.is_default || 0
    ]);
    return result.insertId;
}

/**
 * Obtener tarjetas (métodos de pago) de un usuario
 */
export async function getPaymentMethodsByUserId(connection, userId) {
    const query = `
        SELECT * FROM saved_payment_methods
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at DESC
    `;
    const [rows] = await connection.execute(query, [userId]);
    return rows;
}

/**
 * Obtener un método de pago específico
 */
export async function getPaymentMethodById(paymentMethodId, userId) {
    const query = `
      SELECT * FROM saved_payment_methods 
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `;
    const [rows] = await db.execute(query, [paymentMethodId, userId]);
    return rows[0];
}

/**
 * Eliminar tarjeta o método de pago (soft delete)
 */
export async function deletePaymentMethod(connection, cardId, userId) {
    const query = `
        UPDATE saved_payment_methods
        SET deleted_at = NOW()
        WHERE id = ? AND user_id = ?
    `;
    const [result] = await connection.execute(query, [paymentMethodId, userId]);
    return result;
}

/**
 * Establecer tarjeta como predeterminada
 */
export async function setDefaultPaymentMethod(connection, paymentMethodId, userId) {
    try {
        await connection.beginTransaction();

        // Quitar el default de todos los métodos del usuario
        await connection.execute(
            'UPDATE saved_payment_methods SET is_default = 0 WHERE user_id = ?',
            [userId]
        );

        // Establecer el método seleccionado como default
        await connection.execute(
            'UPDATE saved_payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?',
            [paymentMethodId, userId]
        );

        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Obtener método de pago predeterminado del usuario
 */
export async function getDefaultPaymentMethod(connection, userId) {
    const query = `
      SELECT * FROM saved_payment_methods 
      WHERE user_id = ? AND is_default = 1 AND deleted_at IS NULL
      LIMIT 1
    `;
    const [rows] = await connection.execute(query, [userId]);
    return rows[0];
}

// ==================== SUSCRIPCIONES ====================

/**
 * Crear suscripción
 */
export async function createSubscription(connection, data) {
    const query = `
  INSERT INTO subscriptions (
    user_id,
    payerref,
    paymentmethod,
    amount_minor,
    currency,
    interval_months,
    start_date,
    next_charge_at,
    status,
    order_prefix,
    metadata,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
`;
    const [result] = await db.execute(query, [
        data.user_id,
        data.payerref,
        data.paymentmethod,
        data.amount_minor,
        data.currency || 'EUR',
        data.interval_months || 1,
        data.start_date,
        data.next_charge_at,
        data.status,
        data.order_prefix,
        JSON.stringify(data.metadata || {})
    ]);
    return result.insertId;
}

/**
 * Actualizar suscripción
 */
export async function updateSubscription(connection, subscriptionId, data) {
    const query = `
      UPDATE subscriptions 
      SET 
        status = ?,
        next_charge_at = ?,
        retry_count = ?,
        last_result = ?,
        updated_at = NOW()
      WHERE id = ?
    `;
    const [result] = await connection.execute(query, [
        data.status,
        data.next_charge_at,
        data.retry_count,
        data.last_result,
        subscriptionId
    ]);
    return result;
}

/**
 * Obtener suscripción por usuario
 */
export async function getSubscriptionByUserId(connection, userId) {
    const query = `
  SELECT * FROM subscriptions 
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`;
    const [rows] = await connection.execute(query, [userId]);
    return rows[0];
}

/**
 * Cancelar suscripción en active_products
 */
export async function cancelSubscriptionInActiveProduct(connection, activeProductId) {
    const query = `
  UPDATE active_products 
  SET is_canceled_subscription = 1, updated_at = NOW()
  WHERE active_product_id = ?
`;
    const [result] = await connection.execute(query, [activeProductId]);
    return result;
}


