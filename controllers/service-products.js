import {logActivity} from "../utils/logger.js";

export function testMobileRoute(req, res) {
    res.json({ message: 'Ruta activa para el bloque: movil' })
}


export async function getAllServices(req, res) {
  let connection;
  try {
    connection = await req.db.getConnection();
    const [services] = await connection.query(`
      SELECT service_id AS id,
             name,
             image
      FROM services
      WHERE deleted_at IS NULL
    `);
    res.json(services);
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
    return res.status(400).json({ error: 'Parámetro primary_service_id inválido o ausente' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();
    const [products] = await connection.query(`
      SELECT 
        p.product_id AS id,
        p.product_name_es AS name,
        p.description_es AS description,
        p.sell_price AS price,
        p.product_image AS image,
        p.type_of_product,
        p.centro,
        ps.session
      FROM products p
      JOIN product_services ps ON p.product_id = ps.product_id
      WHERE ps.primary_service_id = ? AND p.deleted_at IS NULL
      GROUP BY p.product_id
    `, [primary_service_id]);

    res.json(products);
  } catch (err) {
    console.error('[ERROR] GET /service-products →', err);
    res.status(500).json({ error: 'Error al obtener productos del servicio', details: err.message });
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

    const [rows] = await connection.execute(`
      SELECT DISTINCT
        p.product_id AS id,
        p.product_name_es AS name,
        p.description_es AS description,
        p.sell_price AS price,
        p.product_image AS image,
        ps.service_id AS service_id,
        ap.expiry_date,
        p.type_of_product,
        ap.centro AS centro,
        s.status AS subscription_status,
        ap.payment_method,
        ap.payment_status,
        ap.active_product_status,
        ap.is_canceled_subscription
      FROM active_products ap
      JOIN products p ON ap.product_id = p.product_id
      LEFT JOIN product_services ps ON p.product_id = ps.product_id
      LEFT JOIN subscriptions s 
        ON s.user_id = ap.customer_id 
       AND s.order_prefix = CONCAT('sub_', ap.customer_id, '_', ap.product_id)
       AND s.id = (
            SELECT MAX(s2.id)
            FROM subscriptions s2
            WHERE s2.user_id = ap.customer_id
              AND s2.order_prefix = CONCAT('sub_', ap.customer_id, '_', ap.product_id)
       )
      WHERE ap.customer_id = ? 
        AND ap.deleted_at IS NULL 
        AND p.deleted_at IS NULL
        AND (ap.expiry_date IS NULL OR ap.expiry_date >= CURDATE())
        AND LOWER(ap.active_product_status) IN ('booked','active','paid')
        AND (
              ap.payment_status = 'paid'
           OR (ap.payment_method = 'bank_transfer' AND ap.payment_status = 'unpaid')
        )
        AND (ap.is_canceled_subscription IS NULL OR ap.is_canceled_subscription = 0)
    `, [user_id]);

    const productosMap = new Map();

    for (const row of rows) {
      if (!productosMap.has(row.id)) {
        productosMap.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          price: row.price,
          image: row.image,
          centro: row.centro,
          type_of_product: row.type_of_product,
          subscription_status: row.subscription_status,
          service_ids: []
        });
      }
      if (row.service_id) {
        productosMap.get(row.id).service_ids.push(row.service_id);
      }
    }

    res.json(Array.from(productosMap.values()));

  } catch (err) {
    console.error('[ERROR] GET /user-products →', err);
    res.status(500).json({ error: 'Error al obtener productos del usuario', details: err.message });
  } finally {
    if (connection) connection.release();
  }
}



// Añade un producto a un usuario
export async function assignProductToUser(req, res) {
  const { user_id, product_id, payment_method, coupon_code, centro } = req.body;

  if (!user_id || !product_id || !payment_method) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // Verificar si ya tiene el producto activo y no expirado
    const [existing] = await connection.execute(`
      SELECT * FROM active_products ap
      WHERE customer_id = ? AND product_id = ?
        AND (ap.expiry_date IS NULL OR ap.expiry_date >= CURDATE())
        AND ap.active_product_status IN ('booked','active','paid')
        AND (ap.is_canceled_subscription IS NULL OR ap.is_canceled_subscription = 0)
        AND ap.deleted_at IS NULL
    `, [user_id, product_id]);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'El producto ya está activo y no ha expirado' });
    }

      // Obtener datos del producto, incluyendo centro
      const [[product]] = await connection.execute(`
        SELECT product_id, sell_price, valid_due, type_of_product, centro
        FROM products WHERE product_id = ?
      `, [product_id]);

      if (!product) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const price = product.sell_price ?? 0;
      const validDays = product.valid_due ?? 0;
      const typeOfProduct = product.type_of_product;
      const centroProducto = (product.centro || '').toLowerCase();

      // Si el producto tiene centro específico, usar ese centro
      let centroFinal = centro;
      if (centroProducto === 'guadarrama' || centroProducto === 'sotillo') {
        centroFinal = centroProducto;
      }
      if (!centroFinal) centroFinal = 'vip';

    // Obtener cupón si se envió
    let couponId = null;
    let discount = 0;

    if (coupon_code) {
      const [[coupon]] = await connection.execute(`
        SELECT coupon_id, discount, is_percentage
        FROM coupons
        WHERE coupon_code = ? AND (product_ids IS NULL OR FIND_IN_SET(?, product_ids))
          AND (expiry_date IS NULL OR expiry_date >= CURDATE())
          AND (deleted_at IS NULL)
      `, [coupon_code, product_id]);

      if (coupon) {
        couponId = coupon.coupon_id;
        const rawDiscount = coupon.discount ?? 0;
        discount = coupon.is_percentage ? price * (rawDiscount / 100) : rawDiscount;
      }
    }

    const totalAmount = Math.max(0, price - discount);

    // Obtener el año y mes actual como YYYYMM
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Contar cuántos invoices hay este mes
    const [[{ count }]] = await connection.execute(`
      SELECT COUNT(*) AS count
      FROM active_products
      WHERE invoice_number LIKE ?
    `, [`R/${yearMonth}/%`]);

    const nextSequence = String(count + 1).padStart(5, '0');
    const invoiceNumber = `R/${yearMonth}/${nextSequence}`;

    // 🔹 Si se paga con monedero
    if (payment_method === "cash") {
      const [[wallet]] = await connection.execute(`
        SELECT balance FROM e_wallet WHERE user_id = ? ORDER BY e_wallet_id DESC LIMIT 1
      `, [user_id]);

      const balance = wallet?.balance ?? 0;

      if (balance < totalAmount) {
        return res.status(402).json({ error: 'Saldo insuficiente en el monedero' });
      }

      await connection.execute(`
        INSERT INTO e_wallet (
          e_wallet_tran_code,
          user_id,
          product_id,
          amount,
          balance,
          transaction_title,
          transaction_type,
          linked_table,
          linked_table_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        `EW-${Date.now()}`,
        user_id,
        product_id,
        -totalAmount,
        balance - totalAmount,
        `Compra producto ${product_id}`,
        'purchase',
        'active_products',
        null
      ]);
    }

      // Ya calculado arriba

    // Insertar producto activo
    const [result] = await connection.execute(`
      INSERT INTO active_products (
        customer_id,
        product_id,
        amount,
        discount,
        total_amount,
        payment_method,
        payment_status,
        purchase_date,
        expiry_date,
        active_product_status,
        coupon_id,
        invoice_number,
        created_at,
        centro
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'booked', ?, ?, NOW(), ?)
    `, [
      user_id,
      product_id,
      price,
      discount,
      totalAmount,
      payment_method,
      "paid",
      validDays,
      couponId,
      invoiceNumber,
      centroFinal
    ]);

    const activeProductId = result.insertId;

    // 🔹 Si es producto recurrente y se pagó con e-wallet → crear suscripción
    if (typeOfProduct === 'recurrent' && payment_method === 'cash') {
      await connection.execute(`
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
          retry_count,
          max_retries,
          order_prefix,
          last_result,
          metadata,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        user_id,
        "user_" + user_id,
        'ewallet',
        Math.round(price * 100), // minor units
        'EUR',
        1, // intervalo mensual
        now,
        new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()), // próxima carga en un mes
        'active',
        0,
        0,
        `sub_${user_id}_${product_id}`,
        JSON.stringify({ ok: true, source: 'ewallet', invoice: invoiceNumber }),
        JSON.stringify({ product_id, active_product_id: activeProductId, method: 'ewallet' })
      ]);
    }

    // ✅ Log activity
    try {
      await logActivity(req, {
        subject: `Producto ${product_id} asignado al usuario ${user_id}${coupon_code ? ` con cupón ${coupon_code}` : ''}, y metodo de pago ${payment_method}`,
        userId: req.user?.id || user_id
      });
    } catch (logErr) {
      console.error("⚠️ Logging error (assignProductToUser):", logErr);
    }

    res.json({ success: true, assigned_id: activeProductId });
  } catch (err) {
    console.error('[ERROR] POST /assign-product →', err);
    res.status(500).json({ error: 'Error al asignar producto', details: err.message });
  } finally {
    if (connection) connection.release();
  }
}


// Elimina la asignación de un producto a un usuario
export async function unassignProductFromUser(req, res) {
  const { user_id, product_id } = req.query;

  if (!user_id || !product_id) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    console.log("🧩 Desasignar → user_id:", user_id, "product_id:", product_id);

    // 🔹 Calcular último día del mes actual
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0); // día 0 del mes siguiente = último del actual
    const lastDayIso = lastDay.toISOString().slice(0, 10); // YYYY-MM-DD

    const feedback = {
      reason: req.body.reason || motivoSeleccionado,   // string corto
      comment: req.body.comment || comentarioLibre,    // texto libre
      date: new Date().toISOString()
    };
    // En lugar de cancelar, extendemos hasta fin de mes
    const [result] = await connection.execute(`
      UPDATE active_products
      SET expiry_date = ?, 
          cancellation_feedback = ?,
          updated_at = NOW()
      WHERE customer_id = ? 
        AND product_id = ? 
        AND deleted_at IS NULL
    `, [lastDayIso, JSON.stringify(feedback), user_id, product_id]);

    // 🔹 Cancelar la suscripción asociada
    const orderPrefix = `sub_${user_id}_${product_id}`;
    const [subResult] = await connection.execute(`
      UPDATE subscriptions
         SET status = 'canceled',
             next_charge_at = NULL,
             updated_at = NOW()
       WHERE user_id = ?
         AND order_prefix = ?
         AND status IN ('active','paused','failed')
    `, [user_id, orderPrefix]);

    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No se encontró producto activo para este usuario' });
    }

    // ✅ Log activity
    try {
      await logActivity(req, {
        subject: `Producto ${product_id} marcado como válido hasta ${lastDayIso} para el usuario ${user_id}, suscripción ${orderPrefix} cancelada`,
        userId: req.user?.id || user_id
      });
    } catch (logErr) {
      console.error("⚠️ Logging error (unassignProductFromUser):", logErr);
    }

    res.json({ 
      success: true, 
      activeProductExtended: result.affectedRows, 
      subscriptionCanceled: subResult.affectedRows,
      valid_until: lastDayIso
    });

  } catch (err) {
    console.error('[ERROR] DELETE /unassign-product →', err);
    res.status(500).json({ error: 'Error al desasignar producto', details: err.message });
  } finally {
    if (connection) await connection.release();
  }
}

export async function getProductDetails(req, res) {
  const { user_id, product_id } = req.query;

  if (!user_id || !product_id) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const [[producto]] = await connection.execute(`
      SELECT 
        ap.purchase_date         AS created_at,
        ap.expiry_date,
        ap.amount,
        ap.discount,
        ap.total_amount,
        ap.payment_method,
        ap.payment_status,
        ap.invoice_number,
        ap.centro,
        p.product_name_es        AS name,
        p.product_image          AS image,
        p.description_es         AS description,
        p.type_of_product,
        p.total_session
      FROM active_products ap
      JOIN products p ON ap.product_id = p.product_id
      WHERE ap.customer_id = ? 
        AND ap.product_id  = ? 
        AND ap.deleted_at IS NULL
      ORDER BY ap.created_at DESC
      LIMIT 1
    `, [user_id, product_id]);

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado para este usuario' });
    }

    const [[vipRow]] = await connection.execute(
      `SELECT COUNT(*) > 0 AS is_vip
      FROM VIP
      WHERE user_id = ? 
        AND (fecha_baja IS NULL OR fecha_baja > NOW())`,
      [user_id]
    );

    const isVip = Boolean(vipRow.is_vip);

    let servicesQuery = `
      SELECT DISTINCT ps.service_id AS id, s.service_name AS name, s.service_image AS image
      FROM product_services ps
      JOIN services s ON s.service_id = ps.service_id
      WHERE ps.product_id = ?
        AND s.deleted_at IS NULL
    `;

    const params = [product_id];

    if (!isVip && producto.centro) {
      // Filtrar por centro si no es VIP
      servicesQuery += " AND s.centro LIKE ?";
      params.push(`%${producto.centro}%`);
    }

    const [services] = await connection.execute(servicesQuery, params);


    let sessions_consumed = 0;
    let sessions_remaining = null;
    let weekly_limit = null;

    if (producto.type_of_product === 'recurrent') {
      // Límite semanal (MAX ps.session)
      const [[lim]] = await connection.execute(`
        SELECT MAX(ps.session) AS weekly_limit
        FROM product_services ps
        WHERE ps.product_id = ?
      `, [product_id]);
      weekly_limit = lim?.weekly_limit ?? null;
    } else {
      // Consumo: reservas hechas con este product_id desde la compra
      const [[consumo]] = await connection.execute(`
        SELECT COUNT(*) AS used
        FROM bookings b
        WHERE b.customer_id = ?
          AND b.product_id  = ?
          AND b.deleted_at IS NULL
          AND b.status IN ('active','booked','completed')
          AND DATE(b.start_date) >= DATE(?)
      `, [user_id, product_id, producto.created_at]);
      sessions_consumed = Number(consumo?.used ?? 0);
      const total = Number(producto.total_session ?? 0);
      sessions_remaining = total ? Math.max(0, total - sessions_consumed) : null;
    }

    res.json({
      created_at: producto.created_at,
      expiry_date: producto.expiry_date,
      amount: producto.amount,
      discount: producto.discount,
      total_amount: producto.total_amount,
      payment_method: producto.payment_method,
      payment_status: producto.payment_status,
      invoice_number: producto.invoice_number ?? null,
      centro: producto.centro ?? null,
      name: producto.name,
      image: producto.image,
      description: producto.description,
      type_of_product: producto.type_of_product,
      total_session: producto.total_session,
      sessions_consumed,
      sessions_remaining,
      weekly_limit,
      services
    });


  } catch (err) {
    console.error('[ERROR] /mobile/product-details →', err);
    res.status(500).json({ error: 'Error al obtener detalles del producto', details: err.message });
  } finally {
    if (connection) connection.release();
  }
}


export async function applyCoupon(req, res) {
  const { coupon_code, user_id, product_id } = req.body;

  if (!coupon_code || !user_id || !product_id) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // 1. Buscar cupón válido por código
    const [rows] = await connection.execute(`
      SELECT customer_ids, product_ids, start_date, expiry_date, deleted_at
      FROM coupons
      WHERE coupon_code = ?
    `, [coupon_code]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }

    const cup = rows[0];

    // 2. Verificar fechas y estado
    const now = new Date();
    const start = new Date(cup.start_date);
    const end = new Date(cup.expiry_date);
    const isDeleted = cup.deleted_at !== null;

    if (isDeleted || now < start || now > end) {
      return res.status(403).json({ error: 'El cupón no está activo actualmente' });
    }

    // 3. Validar producto asociado
    const rawIds = String(cup.product_ids || "")
    const validProducts = rawIds
      .split(',')
      .map(p => parseInt(p.trim()))
      .filter(p => !isNaN(p));

    if (!validProducts.includes(product_id)) {
      return res.status(403).json({ error: 'Este cupón no es válido para este producto' });
    }


    // 4. Revisar si el usuario ya lo usó
    const existingIds = typeof cup.customer_ids === 'string' && cup.customer_ids.trim().length > 0
      ? cup.customer_ids.split(',').map(id => id.trim())
      : [];
    if (existingIds.includes(user_id.toString())) {
      return res.json({ success: true, message: 'Ya has usado este cupón' });
    }

    const newList = [...existingIds, user_id].join(',');

    await connection.execute(`
      UPDATE coupons SET customer_ids = ? WHERE coupon_code = ?
    `, [newList, coupon_code]);


    res.json({ success: true, message: 'Cupón aplicado correctamente' });

  } catch (err) {
    console.error('[ERROR] POST /apply-coupon →', err);
    res.status(500).json({ error: 'Error al aplicar el cupón', details: err.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function searchProducts(req, res) {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: "Falta parámetro query" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const [rows] = await connection.execute(`
      SELECT 
        p.product_id AS id,
        p.product_name_es AS name,
        p.description_es AS description,
        p.sell_price AS price,
        p.product_image AS image
      FROM products p
      WHERE p.deleted_at IS NULL
        AND (p.product_name_es LIKE ? OR p.description_es LIKE ?)
      ORDER BY p.product_name_es ASC
      LIMIT 20
    `, [`%${query}%`, `%${query}%`]);

    res.json(rows);
  } catch (err) {
    console.error("❌ searchProducts:", err);
    res.status(500).json({ error: "Error buscando productos" });
  } finally {
    connection?.release?.();
  }
}
