import stripe from '../config/stripe.config.js';
import * as stripeRepository from '../repositories/stripe.repository.js';
import {
    calculateExpiryDate,
    createStripeMetadata,
    DEFAULT_CURRENCY,
    generateInvoiceNumber,
    PAYMENT_METHOD_CARD,
    PAYMENT_STATUS_PAID,
    toCents
} from '../utils/stripe.utils.js';
import * as productService from "./service-products.service.js";

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
        console.error('Error en createOrGetCustomer:', error);
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
        console.error('Error en getCustomer:', error);
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
        console.error('Error en attachPaymentMethod:', error);
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
        console.error('Error en listPaymentMethods:', error);
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
        console.error('Error en detachPaymentMethod:', error);
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
        console.error('Error en createPaymentIntent:', error);
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
        console.error('Error en confirmPaymentIntent:', error);
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
        console.error('Error en getPaymentIntent:', error);
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
        console.error('Error en cancelPaymentIntent:', error);
        throw error;
    }
}

// ==================== COMPRA DE PRODUCTO ====================

/**
 * Procesar compra de producto
 */
export async function processProductPurchase(dbPool, data) {
    const connection = await dbPool.getConnection();
    try {
        const {
            userId,
            productId,
            paymentMethodId,
            couponId,
            groupId,
            centro
        } = data;

        // 1. Obtener información del producto
        const product = await stripeRepository.getProductById(connection, productId);
        if (!product) {
            throw new Error('Producto no encontrado');
        }

        // 2. Calcular montos
        let amount = parseFloat(product.product_price);
        let discount = 0;
        let totalAmount = amount;

        // Si hay cupón, aplicar descuento (implementar lógica de cupones)
        if (couponId) {
            // TODO: Implementar lógica de cupones
            // discount = ...
            // totalAmount = amount - discount;
        }

        // 3. Crear o obtener cliente de Stripe
        const { customerId } = await this.createOrGetCustomer(userId);

        // 4. Crear Payment Intent
        const paymentIntent = await this.createPaymentIntent({
            amount: totalAmount,
            currency: DEFAULT_CURRENCY,
            customerId: customerId,
            paymentMethodId: paymentMethodId,
            metadata: {
                user_id: userId.toString(),
                product_id: productId.toString(),
                product_name: product.product_name
            }
        });

        // 5. Si el pago fue exitoso, crear registro en la BD
        if (paymentIntent.status === 'succeeded') {
            // Crear transacción de Stripe
            const transactionId = await stripeRepository.createStripeTransaction(connection, {
                product_id: productId,
                customer_id: userId,
                amount: totalAmount,
                stripe_charge_id: paymentIntent.id,
                stripe_card_id: paymentMethodId
            });

            // Calcular fecha de expiración
            const expiryDate = calculateExpiryDate(product.type_of_product);

            // Crear producto activo
            const activeProductId = await stripeRepository.createActiveProduct(connection, {
                product_id: productId,
                invoice_number: generateInvoiceNumber(),
                customer_id: userId,
                group_id: groupId,
                purchase_date: new Date(),
                expiry_date: expiryDate,
                amount: amount,
                discount: discount,
                total_amount: totalAmount,
                coupon_id: couponId,
                payment_status: PAYMENT_STATUS_PAID,
                payment_method: PAYMENT_METHOD_CARD,
                stripe_transaction_id: transactionId,
                card_id: paymentMethodId,
                centro: centro
            });

            return {
                success: true,
                paymentIntent: paymentIntent,
                transactionId: transactionId,
                activeProductId: activeProductId
            };
        } else {
            return {
                success: false,
                paymentIntent: paymentIntent,
                message: 'El pago no se completó correctamente'
            };
        }

    } catch (error) {
        console.error('Error en processProductPurchase:', error);
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
        console.error('Error en createRefund:', error);
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
        const { userId, priceId } = data;

        // 1. Obtener el cliente
        const { customerId } = await this.createOrGetCustomer(dbPool, userId);

        // 2. Crear suscripción en Stripe (ESTADO INCOMPLETO)
        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete', // Esto genera el PaymentIntent necesario
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent'],
        });

        // Guardar en la base de datos
        await stripeRepository.createSubscription(connection, {
            user_id: userId,
            payerref: customerId,
            amount_minor: subscription.items.data[0].price.unit_amount,
            currency: subscription.currency.toUpperCase(),
            interval_months: subscription.items.data[0].price.recurring.interval === 'month' ? 1 : 12,
            start_date: new Date(subscription.start_date * 1000),
            next_charge_at: new Date(subscription.current_period_end * 1000),
            status: subscription.status,
            order_prefix: `SUB-${subscription.id}`,
            metadata: {
                stripe_subscription_id: subscription.id
            }
        });

        return {
            subscription_id: subscription.id,
            client_secret: subscription.latest_invoice.payment_intent.client_secret,
            customer_id: customerId
        };
    } catch (error) {
        console.error('Error en createSubscription:', error);
        throw error;
    }
}

/**
 * Cancelar suscripción
 */
export async function cancelSubscription(dbPool, subscriptionId) {
    const connection = await dbPool.getConnection();
    try {
        const subscription = await stripe.subscriptions.cancel(subscriptionId);


        // Actualizar en la base de datos
        const dbSubscription = await stripeRepository.getSubscriptionByUserId(connection, subscription.customer);
        if (dbSubscription) {
            await stripeRepository.updateSubscription(connection, dbSubscription.id, {
                status: 'canceled',
                next_charge_at: null,
                retry_count: 0,
                last_result: 'Subscription canceled by user'
            });

            let activeProductId = null;
            if (dbSubscription.metadata) {
                try {
                    const parsedMetadata = JSON.parse(dbSubscription.metadata);
                    activeProductId = parsedMetadata.active_product_id ?? parsedMetadata.activeProductId ?? null;
                } catch (parseError) {
                    console.warn('Metadata inválida en suscripción:', parseError);
                }
            }
            if (activeProductId) {
                await stripeRepository.cancelSubscriptionInActiveProduct(connection, activeProductId);
            }
        }

        return subscription;
    } catch (error) {
        console.error('Error en cancelSubscription:', error);
        throw error;
    }
}

/**
 * Obtener suscripción de Stripe
 */
export async function getSubscription(subscriptionId) {
    try {
        return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
        console.error('Error en getSubscription:', error);
        throw error;
    }
}

// ==================== WEBHOOKS ====================

/**
 * Manejar eventos de webhook
 */
export async function handleWebhook(dbPool, event) {
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                await this.handlePaymentIntentSucceeded(dbPool, event.data.object);
                break;

            case 'payment_intent.payment_failed':
                await this.handlePaymentIntentFailed(event.data.object);
                break;

            case 'customer.subscription.created':
                await this.handleSubscriptionCreated(event.data.object);
                break;

            case 'customer.subscription.updated':
                await this.handleSubscriptionUpdated(event.data.object);
                break;

            case 'customer.subscription.deleted':
                await this.handleSubscriptionDeleted(dbPool, event.data.object);
                break;

            case 'invoice.payment_succeeded':
                await this.handleInvoicePaymentSucceeded(event.data.object);
                break;

            case 'invoice.payment_failed':
                await this.handleInvoicePaymentFailed(event.data.object);
                break;

            default:
                console.log(`Evento no manejado: ${event.type}`);
        }

        return { received: true };
    } catch (error) {
        console.error('Error en handleWebhook:', error);
        throw error;
    }
}

// Handlers específicos para cada tipo de evento
export async function handlePaymentIntentSucceeded(dbPool, paymentIntent) {
    console.log('Payment Intent succeeded:', paymentIntent.id);
    // Aquí puedes actualizar el estado en tu base de datos si es necesario
    const connection = await dbPool.getConnection();
    const user_id = paymentIntent.metadata.user_id
    const product_id = paymentIntent.metadata.product_id
    const coupon_code = paymentIntent.metadata.coupon_code

    await productService.assignProduct(connection, {user_id, product_id, payment_method: "card", coupon_code} )
}

export async function handlePaymentIntentFailed(paymentIntent) {
    console.log('Payment Intent failed:', paymentIntent.id);
    // Notificar al usuario del fallo
}

export async function handleSubscriptionCreated(subscription) {
    console.log('Subscription created:', subscription.id);
}

export async function handleSubscriptionUpdated(dbPool, subscription) {
    console.log('Subscription updated:', subscription.id);
    // Actualizar en la base de datos
}

export async function handleSubscriptionDeleted(dbPool, subscription) {
    console.log('Subscription deleted:', subscription.id);
    // Actualizar en la base de datos
    const connection = await dbPool.getConnection();
    await stripeRepository.cancelSubscriptionInActiveProduct(connection, subscription.product_id);
}

export async function handleInvoicePaymentSucceeded(invoice) {
    console.log('Invoice payment succeeded:', invoice.id);
    // Renovar la suscripción en active_products
}

export async function handleInvoicePaymentFailed(invoice) {
    console.log('Invoice payment failed:', invoice.id);
    // Notificar al usuario
}

// ==================== UTILIDADES ====================

/**
 * Verificar webhook signature
 */
export function verifyWebhookSignature(payload, signature) {
    try {
        return stripe.webhooks.constructEvent(
            payload,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.error('Error verificando webhook signature:', error);
        throw error;
    }
}
