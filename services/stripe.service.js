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
 * Adjunta un PaymentMethod ya creado (vía Elements) a un cliente
 */
export async function attachPaymentMethod(paymentMethodId, customerId) {
    try {
        // 1. Adjuntar el método al cliente
        const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
            customer: customerId,
        });

        // 2. IMPORTANTE: Establecerlo como método por defecto para sus futuras facturas
        // Si no haces esto, las suscripciones podrían fallar al intentar cobrar.
        await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethod.id,
            },
        });

        return paymentMethod;
    } catch (error) {
        logger.error({ error: error.message, paymentMethodId, customerId }, 'Error en servicio attachPaymentMethod:');
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

export async function setDefaultPaymentMethod(customerId, paymentMethodId) {
    try {
        return await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });
    } catch (error) {
        logger.error({ error }, 'Error en setDefaultPaymentMethod:');
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
        const { customerId } = await createOrGetCustomer(dbPool, userId);

        logger.info({ userId, priceId, productId, couponCode }, 'Iniciando creación de suscripción en Stripe');

        const subscriptionParams = {
            customer: customerId,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent', 'latest_invoice.confirmation_secret'],
            metadata: {
                user_id: userId.toString(),
                product_id: productId.toString(),
                coupon_code: couponCode || null,
                type: 'subscription'
            }
        };

        if (couponCode) {
            const couponData = await productRepo.getCouponDiscount(connection, couponCode);

            if (!couponData) {
                logger.warn(`El cupón ${couponCode} no existe en la base de datos.`);
                // Opcional: lanzar error si quieres que el proceso se detenga por cupón inválido
            } else {
                // Validación de expiración
                if (couponData.expiry_date) {
                    const expiryTimestamp = Math.floor(new Date(couponData.expiry_date).getTime() / 1000);
                    const nowTimestamp = Math.floor(Date.now() / 1000);

                    if (expiryTimestamp < nowTimestamp) {
                        logger.warn(`El cupón ${couponCode} ha expirado.`);
                        const error = new Error('El cupón ha expirado');
                        error.statusCode = 400;
                        throw error; // Este throw es correcto porque lo capturará el controlador que llamó a esta función
                    }
                }

                if (couponData.is_percentage) {
                    const stripeCouponId = `pct_${couponCode.trim()}`;

                    // Intentamos recuperar o crear el cupón en Stripe
                    // Usamos un pequeño truco: no hace falta el try/catch si confías en que
                    // si falla el retrieve, el error subirá al catch principal.
                    // Pero para ser robustos con el "crear si no existe":
                    try {
                        await stripe.coupons.retrieve(stripeCouponId);
                    } catch (err) {
                        if (err.code === 'resource_missing') {
                            await stripe.coupons.create({
                                id: stripeCouponId,
                                percent_off: couponData.discount,
                                duration: 'forever',
                            });
                        } else {
                            throw err; // Re-lanzamos si es un error distinto a "no encontrado"
                        }
                    }

                    subscriptionParams.discounts = [{ coupon: stripeCouponId }];
                    subscriptionParams.metadata.coupon_code = couponCode;
                }
            }
        }

        const subscription = await stripe.subscriptions.create(subscriptionParams);

        const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret
            || subscription.latest_invoice?.confirmation_secret?.client_secret
            || null;

        if (!clientSecret) {
            logger.warn({ subscriptionId: subscription.id }, '⚠️ Stripe no devolvió client_secret al crear la suscripción.');
        }

        try {
            await ensureLocalSubscription(connection, subscription);
        } catch (localPersistError) {
            logger.error({
                subscriptionId: subscription.id,
                error: localPersistError
            }, '❌ Error guardando suscripción local al crearla. Se continuará con fallback de webhooks.');
        }

        return {
            subscription_id: subscription.id,
            client_secret: clientSecret,
            customer_id: customerId
        };
    } catch (error) {
        // Al relanzar el error aquí después del log, el controlador recibirá
        // el mensaje "El cupón ha expirado" correctamente.
        logger.error({
            message: error.message,
            stack: error.stack,
            details: error
        }, 'Error en createSubscription:');
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Cancelar suscripción
 */
export async function cancelSubscription(dbPool, subscriptionId, userId, productId) {
    const connection = await dbPool.getConnection();

    try {
        logger.info({ subscriptionId, userId, productId }, "[STRIPE] cancelSubscription iniciado");

        // 1️⃣ Añadir metadata de cancelación (no crítico si falla)
        await stripe.subscriptions.update(subscriptionId, {
            metadata: {
                cancellation_reason: 'requested_by_customer',
                cancellation_comment: `Cancelado por usuario ${userId}`
            }
        });

        // 2️⃣ Cancelar expandiendo invoice + payment_intent en una sola llamada
        const canceledSub = await stripe.subscriptions.cancel(subscriptionId, {
            invoice_now: true,
            prorate: true,
            expand: ['latest_invoice.payment_intent']
        });

        logger.info(`✅ Suscripción cancelada en Stripe: ${canceledSub.id}`);

        // 3️⃣ Procesar posible reembolso usando proration real de Stripe
        const invoice = canceledSub.latest_invoice;

        if (invoice && typeof invoice !== 'string') {

            const paymentIntent = invoice.payment_intent;

            if (
                paymentIntent &&
                typeof paymentIntent !== 'string' &&
                paymentIntent.status === 'succeeded'
            ) {
                // 🔎 Buscar líneas de prorrateo negativas (crédito generado por Stripe)
                const prorationLines = invoice.lines?.data?.filter(
                    line => line.proration === true && line.amount < 0
                ) || [];

                const totalCredit = Math.abs(
                    prorationLines.reduce((acc, line) => acc + line.amount, 0)
                );

                if (totalCredit >= 50) { // mínimo Stripe 0.50€
                    logger.info(`🔄 Reembolsando prorrateo exacto: ${(totalCredit / 100).toFixed(2)} €`);

                    await stripe.refunds.create({
                        payment_intent: paymentIntent.id,
                        amount: totalCredit,
                        reason: 'requested_by_customer'
                    });
                } else if (totalCredit > 0) {
                    logger.info(`⚠️ Crédito demasiado pequeño (${(totalCredit / 100).toFixed(2)}€), no se procesa reembolso`);
                }
            }
        }

        // 4️⃣ Actualización inmediata en tu sistema (no esperar webhook)
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
            .toISOString()
            .slice(0, 10);

        logger.info(`🧹 Limpiando base de datos local para usuario ${userId}`);

        await productRepo.cancelActiveProduct(connection, {
            userId,
            productId,
            lastDay
        });

        await stripeRepository.cancelSubscription(connection, subscriptionId);

        return {
            id: canceledSub.id,
            status: canceledSub.status
        };

    } catch (error) {

        // 🔐 Idempotencia real
        if (
            error.type === 'StripeInvalidRequestError' &&
            (error.code === 'resource_missing' ||
                error.message?.includes('No such subscription') ||
                error.message?.includes('canceled'))
        ) {
            logger.info("⚠️ Suscripción ya cancelada en Stripe, sincronizando DB local");

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


export async function createSetupConfig(dbPool, userId) {
    const connection = await dbPool.getConnection();

    try {
        const user = await stripeRepository.getUserById(connection, userId);

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        if (!user.stripe_customer_id) {
            const error = new Error('El usuario no tiene stripe_customer_id asociado');
            error.statusCode = 400;
            throw error;
        }

        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: user.stripe_customer_id },
            { apiVersion: '2026-01-28.clover' }
        );

        const setupIntent = await stripe.setupIntents.create({
            customer: user.stripe_customer_id,
            usage: 'off_session',
            payment_method_types: ['card'],
            metadata: {
                user_id: String(user.user_id)
            }
        });

        return {
            customer_id: user.stripe_customer_id,
            ephemeral_key: ephemeralKey.secret,
            setup_intent_client_secret: setupIntent.client_secret,
            setup_intent_id: setupIntent.id
        };
    } catch (error) {
        logger.error({ error, userId }, 'Error en createSetupConfig:');
        throw error;
    } finally {
        connection.release();
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

            case 'setup_intent.succeeded':
                await this.handleSetupIntentSucceeded(dbPool, object);
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
    const userId = parseInt(paymentIntent.metadata.user_id);
    const productId = parseInt(paymentIntent.metadata.product_id);

    if (!userId || !productId) {
        logger.warn({ paymentIntentId: paymentIntent.id }, '⚠️ PaymentIntent ignorado: Faltan metadatos (user_id o product_id). Probablemente es un pago de suscripción o sistema.');
        return; // Salimos sin llamar a la BD, evitando el error de MySQL
    }

    const connection = await dbPool.getConnection();
    try {
        const couponCode = paymentIntent.metadata.coupon_code|| null;

        await productService.assignProduct(connection, {
            user_id: userId,
            product_id: productId,
            payment_method: "card",
            coupon_code: couponCode
        });

        await stripeRepository.saveStripeTransaction(productId, userId, paymentIntent, connection);

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

export async function handleSetupIntentSucceeded(dbPool, setupIntent) {
    const connection = await dbPool.getConnection();

    try {
        const customerId = setupIntent.customer;
        const paymentMethodId = setupIntent.payment_method;

        if (!customerId || !paymentMethodId) {
            logger.warn({ setupIntentId: setupIntent.id }, 'setup_intent.succeeded sin customer o payment_method');
            return;
        }

        const user = await stripeRepository.getUserByStripeCustomerId(connection, customerId);

        if (!user) {
            logger.warn({ setupIntentId: setupIntent.id, customerId }, 'No se encontró usuario para stripe_customer_id en setup_intent.succeeded');
            return;
        }

        await stripeRepository.updateSubscriptionsPaymentMethodByUserId(
            connection,
            user.user_id,
            paymentMethodId
        );

        logger.info({ setupIntentId: setupIntent.id, userId: user.user_id }, 'Método de pago de suscripciones actualizado tras setup_intent.succeeded');
    } catch (error) {
        logger.error({ error, setupIntentId: setupIntent?.id }, 'Error en handleSetupIntentSucceeded:');
        throw error;
    } finally {
        connection.release();
    }
}

async function ensureLocalSubscription(connection, subscription) {
    if (!subscription?.id) {
        return null;
    }

    const userId = subscription.metadata?.user_id;
    const productId = subscription.metadata?.product_id;

    if (!userId || !productId) {
        logger.warn({ subscriptionId: subscription.id }, '⚠️ Suscripción sin user_id o product_id en metadata. No se puede persistir localmente.');
        return null;
    }

    const existing = await stripeRepository.findSubscriptionById(connection, subscription.id);

    if (existing) {
        await stripeRepository.updateSubscriptionStatus(connection, subscription.id, {
            status: subscription.status,
            payment_method: null,
            next_charge_at: new Date(subscription.current_period_end * 1000)
        });
        return existing;
    }

    await stripeRepository.createSubscription(connection, {
        user_id: userId,
        payer_ref: subscription.customer,
        payment_method: null,
        amount_minor: subscription.items?.data?.[0]?.price?.unit_amount || 0,
        currency: subscription.currency?.toUpperCase() || 'EUR',
        interval_months: subscription.items?.data?.[0]?.price?.recurring?.interval === 'month' ? 1 : 12,
        start_date: new Date(subscription.start_date * 1000),
        next_charge_at: new Date(subscription.current_period_end * 1000),
        status: subscription.status,
        subscription_id: subscription.id,
        metadata: {
            product_id: productId,
            coupon_code: subscription.metadata?.coupon_code || null
        }
    });

    return { subscription_id: subscription.id, user_id: userId, metadata: JSON.stringify({ product_id: productId, coupon_code: subscription.metadata?.coupon_code || null }) };
}

export async function handleSubscriptionCreated(dbPool, subscription) {
    logger.info({ subscriptionId: subscription.id }, 'Subscription created:');

    const connection = await dbPool.getConnection();
    try {
        await ensureLocalSubscription(connection, subscription);
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
    logger.info(
        { subscriptionId: subscription.id },
        '[WEBHOOK] Subscription deleted recibido'
    );

    const connection = await dbPool.getConnection();

    try {

        const userId = subscription.metadata?.user_id;
        const productId = subscription.metadata?.product_id;

        if (!userId || !productId) {
            logger.warn(
                { subscriptionId: subscription.id },
                '⚠️ Subscription.deleted sin metadata completa'
            );

            // Aun así marcamos como cancelada en DB si existe
            await stripeRepository.cancelSubscription(connection, subscription.id);
            return;
        }

        const now = new Date();
        const lastDay = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0
        ).toISOString().slice(0, 10);

        logger.info(
            { userId, productId },
            '🧹 Cancelando producto activo por webhook'
        );

        // 🔐 Idempotente: debe ser seguro ejecutarlo múltiples veces
        await productRepo.cancelActiveProduct(connection, {
            userId,
            productId,
            lastDay
        });

        await stripeRepository.cancelSubscription(connection, subscription.id);

        logger.info(
            { subscriptionId: subscription.id },
            '✅ Sincronización cancelación completada'
        );

    } catch (error) {
        logger.error(
            { error, subscriptionId: subscription.id },
            '❌ Error en handleSubscriptionDeleted'
        );
        throw error; // importante para que Stripe pueda reintentar si falla
    } finally {
        connection.release();
    }
}

export async function handleInvoicePaymentSucceeded(dbPool, invoice) {
    const customerId = invoice.customer;
    const invoiceId = invoice.id;

    logger.info({ invoiceId, customerId }, '--- [WEBHOOK] Procesando Factura de Pago ---');

    const connection = await dbPool.getConnection();

    try {
        // 1. Intentamos buscar por el ID de suscripción (por si acaso viniera)
        let subId = invoice.subscription || invoice.lines?.data[0]?.subscription;
        let subRow = null;

        if (subId) {
            subRow = await stripeRepository.findSubscriptionById(connection, subId);
        }

        // 2. EL SALVAVIDAS: Si no hay ID en la factura, buscamos por el Customer de Stripe
        if (!subRow) {
            logger.warn({ customerId }, '⚠️ Factura sin ID de sub. Buscando última sub "incomplete" del cliente...');

            // Esta función debe buscar en tu tabla 'subscriptions' el registro de este customer
            subRow = await stripeRepository.findIncompleteSubscriptionByPayerRef(connection, customerId);
        }

        if (!subRow) {
            logger.error({ customerId, invoiceId }, '❌ ERROR CRÍTICO: No existe suscripción pendiente en BD para este cliente.');
            return;
        }

        // 3. Ya tenemos los datos de nuestra base de datos (user_id, product_id, etc.)
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
        logger.error({
            message: error.message,
            stack: error.stack,
            details: error
        }, '❌ Error en handleInvoicePaymentSucceeded:');
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
