import * as productRepo from '../repositories/service-products.repository.js';

export const listAllServices = async (connection) => {
  return await productRepo.getServices(connection);
};

export const listServiceProducts = async (connection, serviceId) => {
  return await productRepo.getProductsByServiceId(connection, serviceId);
};

export const listUserProducts = async (connection, userId) => {
  const rows = await productRepo.getActiveProductsByUserId(connection, userId);

  // Lógica de transformación (Map) movida aquí
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
  return Array.from(productosMap.values());
};

export const assignProduct = async (connection, { user_id, product_id, payment_method, coupon_code, centro, stripe_subscription_id }) => {

  // 1. Obtener producto (lo necesitamos para saber cuántos días sumar)
  const product = await productRepo.getProductById(connection, product_id);
  if (!product) {
    throw { status: 404, message: 'Producto no encontrado' };
  }

  // 2. Verificar si el usuario ya tiene este producto activo
  const existing = await productRepo.findActiveProduct(connection, user_id, product_id);

  // 3. LÓGICA DE RENOVACIÓN (Si ya existe y es suscripción)
  if (existing && stripe_subscription_id) {
    console.log(`Renovando producto ${product_id} para el usuario ${user_id}`);

    // Calculamos la nueva fecha: Si ya está vencido, sumamos desde hoy.
    // Si aún es válido, sumamos desde la fecha de vencimiento actual.
    const currentExpiry = new Date(existing.due_date);
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newDueDate = new Date(baseDate.getTime() + (product.valid_due * 24 * 60 * 60 * 1000));

    await productRepo.updateActiveProductExpiry(connection, existing.id, newDueDate);

    return { assigned_id: existing.id, action: 'renewed' };
  }

  // 4. LÓGICA DE PRIMERA ASIGNACIÓN (Lo que ya tenías)
  if (existing && !stripe_subscription_id) {
    throw { status: 409, message: 'El producto ya está activo y no es una renovación' };
  }

  // ... (Tus pasos 3, 4 y 5 de precios, cupones y facturas se mantienen igual) ...
  const price = product.sell_price ?? 0;
  const validDays = product.valid_due ?? 0;
  let centroFinal = centro || product.centro || 'general';
  let couponId = null;
  let discount = 0;

  if (coupon_code) {
    const coupon = await productRepo.getCouponByCode(connection, coupon_code);
    if (coupon) {
      couponId = coupon.coupon_id;
      discount = coupon.is_percentage ? price * (coupon.discount / 100) : coupon.discount;
    }
  }

  // 6. Asignar producto por primera vez
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

  return { assigned_id: result.insertId, action: 'created' };
};

export const unassignProduct = async (connection, userId, productId) => {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  await productRepo.cancelActiveProduct(connection, { userId, productId, lastDay });

  // Intentamos cancelar suscripción, aunque no exista
  await productRepo.cancelSubscription(connection, {
    userId,
    orderPrefix: `sub_${userId}_${productId}`
  });

  return { valid_until: lastDay };
};

export const getActiveProductDetail = async (connection, userId, productId) => {
  const product = await productRepo.getActiveProductDetail(connection, userId, productId);
  if (!product) throw { status: 404, message: 'No encontrado' };

  const services = await productRepo.getProductServices(connection, productId);

  return { ...product, services };
};

export const validateCoupon = async (connection, couponCode) => {
  const coupon = await productRepo.getCouponByCode(connection, couponCode);
  if (!coupon) throw { status: 404, message: 'Cupón inválido' };
  return { message: 'Cupón válido' };
};

export const searchProducts = async (connection, query) => {
  return await productRepo.searchProductsByName(connection, query);
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
