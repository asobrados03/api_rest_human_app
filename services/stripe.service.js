import stripe from '../config/stripe.config.js';
import * as stripeRepository from '../repositories/stripe.repository.js';
import {
    createStripeMetadata,
    DEFAULT_CURRENCY,
    toCents
} from '../utils/stripe.utils.js';
import logger from '../utils/pino.js';
import * as productService from "./service-products.service.js";
import * as productRepo from "../repositories/service-products.repository.js";
// ==================== CLIENTES ====================

/**
 * Crear u obtener cliente de Stripe
 */
export async function createOrGetCustomer(dbPool, userId) {
    const connection = await dbPool.getConnection();

    try {
        const user = await stripeRepository.getUserById(connection, userId);

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        // Si ya tiene stripe_customer_id, retornarlo
        if (user.stripe_customer_id) {
            return {
                customerId: user.stripe_customer_id,
                isNew: false
            };
        }

        // Crear nuevo cliente en Stripe
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.user_name,
            phone: user.phone,
            address: {
                line1: 'Calle Falsa 123', // Opcional, pero recomendado
                city: 'Madrid',
                postal_code: '28001',
                country: 'ES', // <--- ESTO ES LO QUE DESBLOQUEA SEPA
            },
            metadata: {
                user_id: userId.toString()
            }
        });

        // Guardar stripe_customer_id en la base de datos
        await stripeRepository.updateUserStripeCustomerId(connection, userId, customer.id);

        return {
            customerId: customer.id,
            isNew: true
        };
    } catch (error) {
        logger.error({ error }, 'Error en createOrGetCustomer:');
        throw error;
    }
}

/**
 * Obtener cliente de Stripe
 */
export async function getCustomer(stripeCustomerId) {
    try {
        return await stripe.customers.retrieve(stripeCustomerId);
    } catch (error) {
        logger.error({ error }, 'Error en getCustomer:');
        throw error;
    }
}

// ==================== PAYMENT METHODS ====================

/**
 * Adjuntar método de pago a un cliente
 */
export async function attachPaymentMethod(paymentMethodId, customerId) {
    try {
        const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
            customer: customerId,
        });

        // Establecer como método de pago predeterminado
        await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });

        return paymentMethod;
    } catch (error) {
        logger.error({ error }, 'Error en attachPaymentMethod:');
        throw error;
    }
}

/**
 * Listar métodos de pago de un cliente
 */
export async function listPaymentMethods(customerId) {
    try {
        const paymentMethods = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card',
        });
        return paymentMethods.data;
    } catch (error) {
        logger.error({ error }, 'Error en listPaymentMethods:');
        throw error;
    }
}

/**
 * Eliminar método de pago
 */
export async function detachPaymentMethod(paymentMethodId) {
    try {
        return await stripe.paymentMethods.detach(paymentMethodId);
    } catch (error) {
        logger.error({ error }, 'Error en detachPaymentMethod:');
        throw error;
    }
}

// ==================== PAYMENT INTENTS ====================

/**
 * Crear Payment Intent
 */
export async function createPaymentIntent(data) {
    try {
        const { amount, currency, customerId, metadata, paymentMethodId } = data;

        const paymentIntentData = {
            amount: toCents(amount), // Stripe usa centavos
            currency: currency || DEFAULT_CURRENCY,
            customer: customerId,
            metadata: createStripeMetadata(metadata || {}),
            automatic_payment_methods: {
                enabled: true,
            },
        };

        // Si se proporciona un payment method, agregarlo
        if (paymentMethodId) {
            paymentIntentData.payment_method = paymentMethodId;
            paymentIntentData.confirm = true; // Confirmar automáticamente
        }

        return await stripe.paymentIntents.create(paymentIntentData);
    } catch (error) {
        logger.error({ error }, 'Error en createPaymentIntent:');
        throw error;
    }
}

/**
 * Confirmar Payment Intent
 */
export async function confirmPaymentIntent(paymentIntentId, paymentMethodId) {
    try {
        return await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: paymentMethodId,
        });
    } catch (error) {
        logger.error({ error }, 'Error en confirmPaymentIntent:');
        throw error;
    }
}

/**
 * Obtener Payment Intent
 */
export async function getPaymentIntent(paymentIntentId) {
    try {
        return await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
        logger.error({ error }, 'Error en getPaymentIntent:');
        throw error;
    }
}

/**
 * Cancelar Payment Intent
 */
export async function cancelPaymentIntent(paymentIntentId) {
    try {
        return await stripe.paymentIntents.cancel(paymentIntentId);
    } catch (error) {
        logger.error({ error }, 'Error en cancelPaymentIntent:');
        throw error;
    }
}

// ==================== REEMBOLSOS ====================

/**
 * Crear reembolso
 */
export async function createRefund(paymentIntentId, amount = null) {
    try {
        const refundData = {
            payment_intent: paymentIntentId,
        };

        // Si se especifica un monto, reembolsar parcialmente
        if (amount) {
            refundData.amount = toCents(amount);
        }

        return await stripe.refunds.create(refundData);
    } catch (error) {
        logger.error({ error }, 'Error en createRefund:');
        throw error;
    }
}

// ==================== SUSCRIPCIONES ====================

/**
 * Crear suscripción de Stripe
 */
export async function createSubscription(dbPool, data) {
    const connection = await dbPool.getConnection();

    try {
        const { userId, priceId, productId, couponCode } = data;

        // 1. Obtener el cliente (Llamada directa, sin 'this')
        const { customerId } = await createOrGetCustomer(dbPool, userId);

        // 2. Preparar los parámetros de la suscripción
        const subscriptionParams = {
            customer: customerId,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.confirmation_secret'],
            metadata: {
                user_id: userId.toString(),
                product_id: productId.toString(),
                type: 'subscription'
            }
        };

        // Si viene un cupón, lo añadimos a Stripe y a la metadata
        if (couponCode) {
            // 1. Buscamos los datos en tu base de datos local
            const couponData = await productRepo.getCouponDiscount(connection, couponCode);

            if (couponData) {
                let stripeCouponId;

                const expiryTimestamp = couponData.expiry_date
                    ? Math.floor(new Date(couponData.expiry_date).getTime() / 1000)
                    : null;

                if (couponData.is_percentage) {
                    // 2. Creamos o recuperamos un cupón en Stripe que coincida con tu porcentaje
                    stripeCouponId = `pct_${couponCode.trim()}`;

                    try {
                        // Intentamos ver si ya existe en Stripe
                        await stripe.coupons.retrieve(stripeCouponId);
                    } catch (err) {
                        // Si no existe (error 404), lo creamos en Stripe al vuelo
                        await stripe.coupons.create({
                            id: stripeCouponId,
                            percent_off: couponData.discount, // Aquí aplicas el porcentaje de tu DB
                            duration: 'forever', // U 'once' si solo es para el primer mes
                            redeem_by: expiryTimestamp,
                        });
                    }

                    // 3. Lo aplicamos a la suscripción
                    subscriptionParams.discounts = [{ coupon: stripeCouponId }];

                    // Guardamos el código original en metadata para tu lógica interna
                    subscriptionParams.metadata.coupon_code = couponCode;
                }
            } else {
                logger.warn(`El cupón ${couponCode} no existe en la base de datos.`);
            }
        }

        // 3. Crear suscripción en Stripe
        const subscription = await stripe.subscriptions.create(subscriptionParams);

        return {
            subscription_id: subscription.id,
            client_secret: subscription.latest_invoice?.confirmation_secret?.client_secret,
            customer_id: customerId
        };
    } catch (error) {
        logger.error({ error }, 'Error en createSubscription:');
        throw error;
    } finally {
        if (connection) connection.release(); // ¡Importante liberar la conexión!
    }
}

/**
 * Cancelar suscripción
 */
export async function cancelSubscription(dbPool, subscriptionId, userId, productId) {
    const connection = await dbPool.getConnection();
    try {
        await stripe.subscriptions.update(subscriptionId, {
            metadata: {
                cancellation_reason: 'requested_by_customer',
                cancellation_comment: `Cancelado por usuario ${userId}`
            }
        });

        // 2. Cancelar sin los parámetros conflictivos
        const canceledSub = await stripe.subscriptions.cancel(subscriptionId, {
            invoice_now: true,
            prorate: true
        });

        logger.info(`✅ Suscripción cancelada en Stripe: ${canceledSub.id}`);

        // 3. Opcional: Intentar reembolso automático del proration o del último pago
        //    (Stripe no reembolsa automáticamente el crédito → hay que hacerlo manual)
        if (canceledSub.latest_invoice) {
            const invoice = await stripe.invoices.retrieve(canceledSub.latest_invoice.id, {
                expand: ['payment_intent', 'charge']
            });

            // Si hay un payment_intent succeeded del último cobro → podemos reembolsar parcial
            if (invoice.payment_intent && typeof invoice.payment_intent !== 'string') {
                const pi = invoice.payment_intent;

                if (pi.status === 'succeeded' && pi.amount > 0) {
                    const now = Math.floor(Date.now() / 1000);
                    const periodStart = canceledSub.current_period_start;
                    const periodEnd = canceledSub.current_period_end;

                    // Stripe ya calculó el proration credit, pero si quieres reembolso directo:
                    const daysTotal = (periodEnd - periodStart) / 86400;
                    const daysUsed = (now - periodStart) / 86400;
                    const daysRemaining = daysTotal - daysUsed;

                    const proratedRefund = Math.floor((daysRemaining / daysTotal) * pi.amount);

                    if (proratedRefund >= 50) {  // mínimo Stripe
                        logger.info(`🔄 Reembolsando prorrateado: ${(proratedRefund / 100).toFixed(2)} €`);
                        await stripe.refunds.create({
                            payment_intent: pi.id,
                            amount: proratedRefund,
                            reason: 'requested_by_customer'
                        });
                    } else if (proratedRefund > 0) {
                        logger.info(`⚠️ Reembolso muy pequeño (${proratedRefund / 100}€), no se procesa`);
                    }
                }
            }
        }

        // ACTUALIZACIÓN INMEDIATA: No esperes al webhook para limpiar tu DB local
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

        logger.info(`🧹 Limpiando base de datos local para usuario ${userId}...`);

        // Ejecutamos la misma lógica que tiene tu webhook
        await productRepo.cancelActiveProduct(connection, { userId, productId, lastDay });
        await stripeRepository.cancelSubscription(connection, subscriptionId);

        return canceledSub;

    } catch (error) {
        if (error.type === 'StripeInvalidRequestError' &&
            (error.code === 'resource_missing' || error.message?.includes('canceled'))) {
            logger.info("⚠️ Suscripción ya cancelada en Stripe, solo limpiamos DB");
            await stripeRepository.cancelSubscription(connection, subscriptionId);
            return { id: subscriptionId, status: 'canceled' };
        }

        logger.error({ error, subscriptionId }, '❌ Error cancelando suscripción:');
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Obtener suscripción de Stripe
 */
export async function getSubscription(subscriptionId) {
    try {
        return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
        logger.error({ error }, 'Error en getSubscription:');
        throw error;
    }
}

// ==================== WEBHOOKS ====================

/**
 * Manejar eventos de webhook
 */
export async function handleWebhook(dbPool, event) {
    const object = event.data.object;

    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                // ¡¡¡AQUÍ ESTÁ LA CLAVE DEL ERROR!!!
                // Si el payment_intent tiene un campo 'invoice', significa que es de una suscripción.
                // Debemos IGNORARLO aquí, porque ya lo maneja el caso 'invoice.payment_succeeded'.
                if (object.invoice) {
                    logger.info('Ignorando PaymentIntent de suscripción (se manejará en invoice.payment_succeeded)');
                    return;
                }

                // Solo si NO tiene invoice, es una compra de producto único
                await this.handlePaymentIntentSucceeded(dbPool, object);
                break;

            case 'payment_intent.payment_failed':
                await this.handlePaymentIntentFailed(object);
                break;

            case 'customer.subscription.created':
                await this.handleSubscriptionCreated(dbPool, object);
                break;

            case 'customer.subscription.updated':
                await this.handleSubscriptionUpdated(object);
                break;

            case 'customer.subscription.deleted':
                await this.handleSubscriptionDeleted(dbPool, object);
                break;

            case 'invoice.payment_succeeded':
                await this.handleInvoicePaymentSucceeded(dbPool, object);
                break;

            case 'invoice.payment_failed':
                await this.handleInvoicePaymentFailed(object);
                break;

            default:
                logger.info(`Evento no manejado: ${event.type}`);
        }

        return { received: true };
    } catch (error) {
        logger.error({ error }, 'Error en handleWebhook:');
        throw error;
    }
}

// Handlers específicos para cada tipo de evento

export async function handlePaymentIntentSucceeded(dbPool, paymentIntent) {
    logger.info({ paymentIntentId: paymentIntent.id }, 'Procesando Payment Intent (Tienda):');

    // Protección contra undefined
    const userId = paymentIntent.metadata?.user_id;
    const productId = paymentIntent.metadata?.product_id;

    if (!userId || !productId) {
        logger.warn({ paymentIntentId: paymentIntent.id }, '⚠️ PaymentIntent ignorado: Faltan metadatos (user_id o product_id). Probablemente es un pago de suscripción o sistema.');
        return; // Salimos sin llamar a la BD, evitando el error de MySQL
    }

    const connection = await dbPool.getConnection();
    try {
        const couponCode = paymentIntent.metadata.coupon_code;

        await productService.assignProduct(connection, {
            user_id: userId,
            product_id: productId,
            payment_method: "card",
            coupon_code: couponCode
        });

        await stripeRepository.saveStripeTransaction(userId, productId, paymentIntent, connection);

    } catch (error) {
        logger.error({ error, paymentIntentId: paymentIntent.id }, 'Error en handlePaymentIntentSucceeded:');
    } finally {
        connection.release();
    }
}

export async function handlePaymentIntentFailed(paymentIntent) {
    logger.info({ paymentIntentId: paymentIntent.id }, 'Payment Intent failed:');
    // Notificar al usuario del fallo
}

export async function handleSubscriptionCreated(dbPool, subscription) {
    logger.info({ subscriptionId: subscription.id }, 'Subscription created:');

    const connection = await dbPool.getConnection();
    try {
        const customerId = subscription.customer;
        const userId = subscription.metadata?.user_id;
        const productId = subscription.metadata?.product_id;

        if (!userId || !productId) {
            logger.warn({ subscriptionId: subscription.id }, '⚠️ Suscripción creada sin user_id o product_id en metadata. No se guardará en DB local.');
            return;
        }

        await stripeRepository.createSubscription(connection, {
            user_id: userId,
            payer_ref: customerId,
            payment_method: null,
            amount_minor: subscription.items.data[0].price.unit_amount,
            currency: subscription.currency.toUpperCase(),
            interval_months: subscription.items.data[0].price.recurring.interval === 'month' ? 1 : 12,
            start_date: new Date(subscription.start_date * 1000),
            next_charge_at: new Date(subscription.current_period_end * 1000),
            status: subscription.status,
            subscription_id: subscription.id,
            metadata: {
                product_id: productId,
            }
        });
    } catch (error) {
        logger.error({ error, subscriptionId: subscription.id }, 'Error en handleSubscriptionCreated:');
    } finally {
        connection.release();
    }
}

export async function handleSubscriptionUpdated(dbPool, subscription) {
    // 1. ESCUDO DE SEGURIDAD (Esto evita el crash)
    if (!subscription || !subscription.id) {
        // Si no hay datos, salimos silenciosamente sin romper el servidor
        return;
    }

    logger.info({ subscriptionId: subscription.id }, 'Webhook: Subscription updated:');

    const connection = await dbPool.getConnection();
    try {
        // 2. Solo actualizamos datos relevantes
        await stripeRepository.updateSubscriptionStatus(connection, subscription.id, {
            status: subscription.status,
            // Actualizamos la fecha de cobro si ha cambiado
            next_charge_at: new Date(subscription.current_period_end * 1000)
        });

    } catch (error) {
        logger.error({ error, subscriptionId: subscription.id }, 'Error en handleSubscriptionUpdated:');
    } finally {
        connection.release();
    }
}

export async function handleSubscriptionDeleted(dbPool, subscription) {
    logger.info({ subscriptionId: subscription.id }, 'Subscription deleted:');

    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const userId = subscription.metadata?.user_id;
    const productId = subscription.metadata?.product_id;

    // Actualizar en la base de datos
    const connection = await dbPool.getConnection();
    await productRepo.cancelActiveProduct(connection, { userId, productId, lastDay });
    await stripeRepository.cancelSubscription(connection, subscription.id);
}

export async function handleInvoicePaymentSucceeded(dbPool, invoice) {
    logger.info('--- [WEBHOOK] Procesando Pago ---');

    const connection = await dbPool.getConnection();

    try {
        // 1. BUSCAR EN BD USANDO EL CLIENTE (payer_ref)
        // Sacamos el subscription_id, user_id y el productId (que está en metadata)
        const subRow = await stripeRepository.findIncompleteSubscriptionByPayerRef(connection, invoice.customer);
        if (!subRow) {
            logger.info({ customer: invoice.customer }, '⚠️ No se encontró suscripción pendiente para este cliente.');
            return;
        }

        const { subscription_id, user_id, metadata } = subRow;
        let productId = null;
        let couponCode = null;

        // 2. EXTRAER PRODUCTID DE TU METADATA
        if (metadata) {
            try {
                const meta = JSON.parse(metadata);
                productId = meta.product_id;
                couponCode = meta.coupon_code || null;
            } catch (e) { logger.error("Error parseando metadata local"); }
        }

        if (!productId || !user_id) {
            logger.error({ subscription_id, user_id }, '❌ Faltan datos críticos en la BD local para activar.');
            return;
        }

        // 3. ACTUALIZAR Y ACTIVAR
        // Marcamos como activa en tu tabla
        await stripeRepository.updateSubscriptionStatus(connection, subscription_id, {
            status: 'active',
            payment_method: "card",
            next_charge_at: new Date(invoice.lines?.data[0]?.period?.end * 1000)
        });

        // Activamos el producto en tu lógica de negocio
        await productService.assignProduct(connection, {
            user_id: user_id,
            product_id: productId,
            payment_method: "card",
            coupon_code: couponCode,
            subscription_id: subscription_id,
            centro: invoice.metadata?.centro || null
        });

        logger.info({ userId: user_id, productId }, `✅ ¡LISTO! Usuario ${user_id} activado con producto ${productId}`);

    } catch (error) {
        logger.error({ error }, '❌ Error en handleInvoicePaymentSucceeded:');
    } finally {
        connection.release();
    }
}

export async function handleInvoicePaymentFailed(invoice) {
    logger.info({ invoiceId: invoice.id }, 'Invoice payment failed:');
    // Notificar al usuario
}

export function verifyWebhookSignature(payload, signature) {
    try {
        return stripe.webhooks.constructEvent(
            payload,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        logger.error({ error }, 'Error verificando webhook signature:');
        throw error;
    }
}
