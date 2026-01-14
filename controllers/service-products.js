import { logActivity } from "../utils/logger.js";

export function testMobileRoute(req, res) {
  res.json({ message: 'Ruta activa para el bloque: movil' });
}

export async function getAllServices(req, res) {
  let connection;
  try {
    connection = await req.db.getConnection();
    const [services] = await connection.query(`
      SELECT service_id AS id,
             service_name AS name,
             service_image AS image
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

    // Eliminada la lógica de suscripciones complejas para evitar errores si no se usa
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
        ap.payment_method,
        ap.payment_status,
        ap.active_product_status
       FROM active_products ap
       JOIN products p ON ap.product_id = p.product_id
       LEFT JOIN product_services ps ON p.product_id = ps.product_id
      WHERE ap.customer_id = ?
        AND ap.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND (ap.expiry_date IS NULL OR ap.expiry_date >= CURDATE())
        AND LOWER(ap.active_product_status) IN ('booked','active','paid')
        AND (
        ap.payment_status = 'paid'
          OR (ap.payment_method = 'bank_transfer' AND ap.payment_status = 'unpaid')
        )
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

export async function assignProductToUser(req, res) {
  const { user_id, product_id, payment_method, coupon_code, centro } = req.body;

  if (!user_id || !product_id || !payment_method) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const [existing] = await connection.execute(`
            SELECT * FROM active_products
            WHERE customer_id = ? AND product_id = ?
                AND (expiry_date IS NULL OR expiry_date >= CURDATE())
                AND active_product_status IN ('booked','active','paid')
                AND deleted_at IS NULL
        `, [user_id, product_id]);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'El producto ya está activo' });
    }

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

    // Lógica de centro simplificada
    let centroFinal = centro || product.centro || 'general';

    let couponId = null;
    let discount = 0;

    if (coupon_code) {
      const [[coupon]] = await connection.execute(`
                SELECT coupon_id, discount, is_percentage
                FROM coupons
                WHERE coupon_code = ? AND (deleted_at IS NULL)
            `, [coupon_code]);

      if (coupon) {
        couponId = coupon.coupon_id;
        discount = coupon.is_percentage ? price * (coupon.discount / 100) : coupon.discount;
      }
    }

    const totalAmount = Math.max(0, price - discount);
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [[{ count }]] = await connection.execute(`
            SELECT COUNT(*) AS count FROM active_products WHERE invoice_number LIKE ?
        `, [`R/${yearMonth}/%`]);

    const invoiceNumber = `R/${yearMonth}/${String(count + 1).padStart(5, '0')}`;

    if (payment_method === "cash") {
      const [[wallet]] = await connection.execute(`
                SELECT balance FROM e_wallet WHERE user_id = ? ORDER BY e_wallet_id DESC LIMIT 1
            `, [user_id]);

      if ((wallet?.balance ?? 0) < totalAmount) {
        return res.status(402).json({ error: 'Saldo insuficiente' });
      }

      await connection.execute(`
                INSERT INTO e_wallet (user_id, product_id, amount, balance, transaction_type, created_at)
                VALUES (?, ?, ?, ?, 'purchase', NOW())
            `, [user_id, product_id, -totalAmount, (wallet.balance - totalAmount)]);
    }

    const [result] = await connection.execute(`
            INSERT INTO active_products (
                customer_id, product_id, amount, discount, total_amount, 
                payment_method, payment_status, purchase_date, expiry_date, 
                active_product_status, coupon_id, invoice_number, created_at, centro
            ) VALUES (?, ?, ?, ?, ?, ?, 'paid', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'booked', ?, ?, NOW(), ?)
        `, [user_id, product_id, price, discount, totalAmount, payment_method, validDays, couponId, invoiceNumber, centroFinal]);

    // Registro en subscriptions si es recurrente
    if (typeOfProduct === 'recurrent') {
      await connection.execute(`
                INSERT INTO subscriptions (user_id, amount_minor, status, order_prefix, created_at)
                VALUES (?, ?, 'active', ?, NOW())
            `, [user_id, Math.round(totalAmount * 100), `sub_${user_id}_${product_id}`]);
    }

    await logActivity(req, { subject: `Producto ${product_id} asignado a ${user_id}`, userId: user_id });
    res.json({ success: true, assigned_id: result.insertId });

  } catch (err) {
    console.error('[ERROR] POST /assign-product →', err);
    res.status(500).json({ error: 'Error al asignar producto', details: err.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function unassignProductFromUser(req, res) {
  const { user_id, product_id } = req.query;
  if (!user_id || !product_id) return res.status(400).json({ error: 'Faltan parámetros' });

  let connection;
  try {
    connection = await req.db.getConnection();
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    await connection.execute(`
            UPDATE active_products
            SET expiry_date = ?, updated_at = NOW(), active_product_status = 'canceled'
            WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL
        `, [lastDay, user_id, product_id]);

    await connection.execute(`
            UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
            WHERE user_id = ? AND order_prefix = ?
        `, [user_id, `sub_${user_id}_${product_id}`]);

    res.json({ success: true, valid_until: lastDay });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function getProductDetails(req, res) {
  const { user_id, product_id } = req.query;
  if (!user_id || !product_id) return res.status(400).json({ error: 'Faltan parámetros' });

  let connection;
  try {
    connection = await req.db.getConnection();
    const [[producto]] = await connection.execute(`
      SELECT ap.purchase_date AS created_at, ap.expiry_date, ap.total_amount, ap.centro,
             p.product_name_es AS name, p.product_image AS image, p.description_es AS description,
             p.type_of_product, p.total_session
      FROM active_products ap
             JOIN products p ON ap.product_id = p.product_id
      WHERE ap.customer_id = ? AND ap.product_id = ? AND ap.deleted_at IS NULL
      ORDER BY ap.created_at DESC LIMIT 1
    `, [user_id, product_id]);

    if (!producto) return res.status(404).json({ error: 'No encontrado' });

    // Corregido service_name y service_image según tu tabla
    const [services] = await connection.execute(`
            SELECT DISTINCT s.service_id AS id, s.service_name AS name, s.service_image AS image
            FROM product_services ps
            JOIN services s ON s.service_id = ps.service_id
            WHERE ps.product_id = ? AND s.deleted_at IS NULL
        `, [product_id]);

    res.json({ ...producto, services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function applyCoupon(req, res) {
  const { coupon_code, user_id, product_id } = req.body;
  let connection;
  try {
    connection = await req.db.getConnection();
    const [rows] = await connection.execute(`SELECT * FROM coupons WHERE coupon_code = ?`, [coupon_code]);
    if (!rows.length) return res.status(404).json({ error: 'Cupón inválido' });
    res.json({ success: true, message: 'Cupón válido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function searchProducts(req, res) {
  const { query } = req.query;
  let connection;
  try {
    connection = await req.db.getConnection();
    const [rows] = await connection.execute(`
      SELECT product_id AS id, product_name_es AS name, sell_price AS price, product_image AS image
      FROM products WHERE deleted_at IS NULL AND product_name_es LIKE ? LIMIT 20
    `, [`%${query}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
}
