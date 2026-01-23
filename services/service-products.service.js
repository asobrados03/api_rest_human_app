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

export const assignProduct = async (connection, { user_id, product_id, payment_method, coupon_code, centro }) => {
  // 1. Verificar existencia
  const existing = await productRepo.findActiveProduct(connection, user_id, product_id);
  if (existing) {
    throw { status: 409, message: 'El producto ya está activo' };
  }

  // 2. Obtener producto
  const product = await productRepo.getProductById(connection, product_id);
  if (!product) {
    throw { status: 404, message: 'Producto no encontrado' };
  }

  // 3. Calcular precios y descuentos
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

  // 7. Suscripción recurrente
  if (product.type_of_product === 'recurrent') {
    await productRepo.createSubscription(connection, {
      userId: user_id,
      totalAmount,
      orderPrefix: `sub_${user_id}_${product_id}`
    });
  }

  return { assigned_id: result.insertId };
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

export const getDetails = async (connection, userId, productId) => {
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
