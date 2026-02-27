import logger from '../utils/pino.js';
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
 * Obtener transacciones por usuario
 */
export async function getTransactionsByCustomerId(dbPool, customerId) {
    const connection = await dbPool.getConnection();

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
// ==================== SUSCRIPCIONES ====================

/**
 * Crear suscripción
 */
export async function createSubscription(connection, data) {
    const query = `
  INSERT INTO subscriptions (
    user_id,
    payer_ref,
    payment_method,
    amount_minor,
    currency,
    interval_months,
    start_date,
    next_charge_at,
    status,
    subscription_id,
    metadata,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
`;
    const [result] = await connection.execute(query, [
        data.user_id,
        data.payer_ref,
        data.payment_method,
        data.amount_minor,
        data.currency || 'EUR',
        data.interval_months || 1,
        data.start_date,
        data.next_charge_at,
        data.status,
        data.subscription_id,
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

export async function cancelSubscription(connection, subscriptionId) {
    const query = `
  UPDATE subscriptions 
  SET status = 'canceled', updated_at = NOW() 
  WHERE subscription_id = ?
`;
    const [result] = await connection.execute(query, [subscriptionId]);
    return result;
}

/**
 * Actualiza el estado y metadatos de una suscripción basada en el ID de Stripe
 */
export async function updateSubscriptionStatus(connection, subscription_id, data) {
    const { status, payment_method, next_charge_at } = data;

    // Construimos la query dinámicamente para actualizar solo lo que venga en 'data'
    const updates = [];
    const values = [];

    if (status) {
        updates.push("status = ?");
        values.push(status);
    }

    if (payment_method) {
        updates.push("payment_method = ?");
        values.push(payment_method);
    }

    if (next_charge_at) {
        updates.push("next_charge_at = ?");
        values.push(next_charge_at);
    }

    if (updates.length === 0) return;

    // Añadimos el ID de Stripe al final para el WHERE
    values.push(subscription_id);

    const query = `
        UPDATE subscriptions 
        SET ${updates.join(", ")} 
        WHERE subscription_id = ?
    `;

    try {
        const [result] = await connection.execute(query, values);

        if (result.affectedRows === 0) {
            logger.warn({ subscription_id }, '⚠️ No se encontró ninguna suscripción local para el ID');
        } else {
            logger.info({ subscription_id, status }, `✅ Suscripción ${subscription_id} actualizada a estado: ${status}`);
        }

        return result;
    } catch (error) {
        logger.error({ error, subscription_id }, '❌ Error en updateSubscriptionStatus Repository:');
        throw error;
    }
}

export async function saveStripeTransaction(productId, userId, paymentIntent, connection) {
    const query = `INSERT INTO stripe_transactions (product_id, customer_id, amount, stripe_charge_id, stripe_card_id)
                   VALUES (?, ?, ?, ?, ?)`;

    const result = await connection.execute(query,
        [productId, userId, paymentIntent.amount / 100, paymentIntent.id, paymentIntent.payment_method]
    );
    return result[0].insertId;
}

export async function findSubscriptionById(connection, subscription_id) {
    if (!subscription_id) {
        logger.warn({ subscription_id }, '⚠️ findSubscriptionById llamado sin subscription_id válido.');
        return null;
    }

    const [rows] = await connection.execute(
        `SELECT subscription_id, user_id, metadata
         FROM subscriptions
         WHERE subscription_id = ?
         LIMIT 1`,
        [subscription_id]
    );
    return rows.length ? rows[0] : null;
}

export async function findIncompleteSubscriptionByPayerRef(connection, payer_ref) {
    if (!payer_ref) {
        logger.warn({ payer_ref }, '⚠️ findSubscriptionByCustomer llamado sin payer_ref válido.');
        return null;
    }

    const [rows] = await connection.execute(
        `SELECT subscription_id, user_id, metadata
         FROM subscriptions
         WHERE payer_ref = ? AND status = 'incomplete'
         ORDER BY created_at DESC 
         LIMIT 1`,
        [payer_ref]
    );
    return rows.length ? rows[0] : null;
}
