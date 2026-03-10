import * as productRepo from '../repositories/service-products.repository.js';

import logger from '../utils/pino.js';
export const listAllServices = async (connection) => {
  return await productRepo.getServices(connection);
};

export const listServiceProducts = async (connection, serviceId) => {
  return await productRepo.getProductsByServiceId(connection, serviceId);
};

export const listUserProducts = async (connection, userId) => {
  const rows = await productRepo.getActiveProductsByUserId(connection, userId);
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
        stripe_subscription_id: row.stripe_subscription_id,
        stripe_payment_intent_id: row.stripe_payment_intent_id,
        service_ids: []
      });
    }
    if (row.service_id) {
      productosMap.get(row.id).service_ids.push(row.service_id);
    }
  }
  return Array.from(productosMap.values());
};

export const assignProduct = async (connection, { user_id, product_id, payment_method, coupon_code, centro, subscription_id }) => {

  // 1. Obtener producto (lo necesitamos para saber cuántos días sumar)
  const product = await productRepo.getProductById(connection, product_id);
  if (!product) {
    throw { status: 404, message: 'Producto no encontrado' };
  }

  // 2. Verificar si el usuario ya tiene este producto activo
  const existing = await productRepo.findActiveProduct(connection, user_id, product_id);

  // 3. LÓGICA DE RENOVACIÓN (Si ya existe y es suscripción)
  if (existing && subscription_id) {
    logger.info(`Renovando producto ${product_id} para el usuario ${user_id}`);

    // Calculamos la nueva fecha: Si ya está vencido, sumamos desde hoy.
    // Si aún es válido, sumamos desde la fecha de vencimiento actual.
    const currentExpiry = new Date(existing.due_date);
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newDueDate = new Date(baseDate.getTime() + (product.valid_due * 24 * 60 * 60 * 1000));

    await productRepo.updateActiveProductExpiry(connection, existing.id, newDueDate);

    return { assigned_id: existing.id, action: 'renewed' };
  }

  // 4. LÓGICA DE PRIMERA ASIGNACIÓN (Lo que ya tenías)
  if (existing && !subscription_id) {
    throw { status: 409, message: 'El producto ya está activo y no es una renovación' };
  }

  // 3. Calcular precios y descuentos
  const price = product.sell_price ?? 0;
  const validDays = product.valid_due ?? 0;
  let centroFinal = centro || product.centro || 'general';
  let couponId = null;
  let discount = 0;

  logger.info({ coupon_code }, "DEBUG: Cupón recibido en assignProduct");

  if (coupon_code && coupon_code.trim() !== "") {
    // .trim() para evitar errores por espacios en blanco
    const coupon = await productRepo.getCouponByCode(connection, coupon_code.trim());

    if (coupon) {
      couponId = coupon.coupon_id;
      // Cálculo del descuento basado en los datos de la DB
      discount = coupon.is_percentage
          ? price * (coupon.discount / 100)
          : coupon.discount;

      logger.info({ couponId, discount }, "✅ Cupón aplicado correctamente");
    } else {
      logger.warn({ coupon_code }, "⚠️ El código de cupón no se encontró en la base de datos");
    }
  }

  const totalAmount = Math.max(0, price - discount);

  // 4. Generar número de factura
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const count = await productRepo.countInvoicesByPrefix(connection, `R/${yearMonth}/%`);
  const invoiceNumber = `R/${yearMonth}/${String(count + 1).padStart(5, '0')}`;

  // 5. Gestión de pagos (Cash/Wallet)
  if (payment_method === "cash") {
    const currentBalance = await productRepo.getLatestWalletBalance(connection, user_id);
    if (currentBalance < totalAmount) {
      throw { status: 402, message: 'Saldo insuficiente' };
    }

    await productRepo.createWalletTransaction(connection, {
      userId: user_id,
      productId: product_id,
      amount: -totalAmount,
      newBalance: currentBalance - totalAmount
    });
  }

  // 6. Asignar producto
  const result = await productRepo.createActiveProduct(connection, {
    userId: user_id,
    productId: product_id,
    price,
    discount,
    totalAmount,
    paymentMethod: payment_method,
    validDays,
    couponId,
    invoiceNumber,
    centro: centroFinal
  });

  if(payment_method === "cash" && product.type_of_product === "recurrent") {
    // Si es una suscripción, también creamos el registro en subscriptions
    await productRepo.createSubscription(connection, {
      userId: user_id,
      totalAmount,
      subscription_id: `sub_${user_id}_${product_id}`
    });
  }

  return { assigned_id: result.insertId, action: 'created' };
};

export const unassignProduct = async (connection, userId, productId) => {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  await productRepo.cancelActiveProduct(connection, { userId, productId, lastDay });

  // Intentamos cancelar suscripción, aunque no exista
  await productRepo.cancelSubscription(connection, {
    userId,
    subscription_id: `sub_${userId}_${productId}`
  });

  return { valid_until: lastDay };
};

export const getActiveProductDetail = async (connection, userId, productId) => {
  const product = await productRepo.getActiveProductDetail(connection, userId, productId);
  if (!product) throw { status: 404, message: 'No encontrado' };

  const services = await productRepo.getProductServices(connection, productId);

  return { ...product, services };
};

export async function getProductDetail(dbPool, productId) {
  if (!Number.isInteger(productId) || productId <= 0) {
    const error = new Error('Invalid product id');
    error.status = 400;
    throw error;
  }
  const connection = await dbPool.getConnection();

  const product = await productRepo.getProductDetailById(connection, productId);

  if (!product) {
    const error = new Error('Product not found');
    error.status = 404;
    throw error;
  }

  return product;
}
