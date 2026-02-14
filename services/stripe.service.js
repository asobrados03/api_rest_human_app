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
        const { userId, priceId, productId } = data;

        // 1. Obtener el cliente (Llamada directa, sin 'this')
        const { customerId } = await createOrGetCustomer(dbPool, userId);

        // 2. Crear suscripción en Stripe
        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: priceId }],
            collection_method: 'send_invoice',
            days_until_due: 15,
            payment_settings: {
                save_default_payment_method: 'on_subscription',
                payment_method_types: ['card', 'customer_balance'],
                payment_method_options: {
                    customer_balance: {
                        funding_type: 'bank_transfer',
                        bank_transfer: {
                            type: 'eu_bank_transfer',
                            eu_bank_transfer: {
                                country: 'IE' // Forzamos para validar el esquema de la API
                            }
                        }
                    }
                }
            },
            expand: ['latest_invoice.payment_intent'],
            metadata: {
                user_id: userId.toString(),
                product_id: productId.toString()
            }
        });

        let clientSecret = null;

        // 2. Finalizar la factura y obtener el confirmation_secret
        if (subscription.latest_invoice) {
            const invoiceId = typeof subscription.latest_invoice === 'string'
                ? subscription.latest_invoice
                : subscription.latest_invoice.id;

            const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoiceId, {
                expand: ['confirmation_secret'] // <--- CLAVE: Expandir el secreto de confirmación
            });

            // 3. Extraer el secreto de la manera que tú indicas
            clientSecret = finalizedInvoice.confirmation_secret?.client_secret;
        }

        const billingName = subscription.customer.name || 'Cliente';
        const billingEmail = subscription.customer.email || '';
        const billingCountry = subscription.customer.address?.country || '';

        return ({
            subscription_id: subscription.id,
            customer_id: customerId,
            client_secret: clientSecret,
            /*billing_name: billingName,
            billing_email: billingEmail,
            billing_country: billingCountry*/
        });
    } catch (error) {
        console.error('Error en createSubscription:', error);
        throw error;
    } finally {
        if (connection) connection.release(); // ¡Importante liberar la conexión!
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
    const object = event.data.object;

    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                // ¡¡¡AQUÍ ESTÁ LA CLAVE DEL ERROR!!!
                // Si el payment_intent tiene un campo 'invoice', significa que es de una suscripción.
                // Debemos IGNORARLO aquí, porque ya lo maneja el caso 'invoice.payment_succeeded'.
                if (object.invoice) {
                    console.log('Ignorando PaymentIntent de suscripción (se manejará en invoice.payment_succeeded)');
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
                console.log(`Evento no manejado: ${event.type}`);
        }

        return { received: true };
    } catch (error) {
        console.error('Error en handleWebhook:', error);
        throw error;
    }
}

// Handlers específicos para cada tipo de evento
// En stripe.service.js

export async function handlePaymentIntentSucceeded(dbPool, paymentIntent) {
    console.log('Procesando Payment Intent (Tienda):', paymentIntent.id);

    // Protección contra undefined
    const userId = paymentIntent.metadata?.user_id;
    const productId = paymentIntent.metadata?.product_id;

    if (!userId || !productId) {
        console.warn('⚠️ PaymentIntent ignorado: Faltan metadatos (user_id o product_id). Probablemente es un pago de suscripción o sistema.');
        return; // Salimos sin llamar a la BD, evitando el error de MySQL
    }

    const connection = await dbPool.getConnection();
    try {
        const coupon_code = paymentIntent.metadata.coupon_code;

        await productService.assignProduct(connection, {
            user_id: userId,
            product_id: productId,
            payment_method: "card",
            coupon_code
        });

    } catch (error) {
        console.error('Error en handlePaymentIntentSucceeded:', error);
    } finally {
        connection.release();
    }
}

export async function handlePaymentIntentFailed(paymentIntent) {
    console.log('Payment Intent failed:', paymentIntent.id);
    // Notificar al usuario del fallo
}

export async function handleSubscriptionCreated(dbPool, subscription) {
    console.log('Subscription created:', subscription.id);

    const connection = await dbPool.getConnection();
    try {
        const customerId = subscription.customer;
        const userId = subscription.metadata?.user_id;
        const productId = subscription.metadata?.product_id;

        if (!userId || !productId) {
            console.warn('⚠️ Suscripción creada sin user_id o product_id en metadata. No se guardará en DB local.');
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
        console.error('Error en handleSubscriptionCreated:', error);
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

    console.log('Webhook: Subscription updated:', subscription.id);

    const connection = await dbPool.getConnection();
    try {
        // 2. Solo actualizamos datos relevantes
        await stripeRepository.updateSubscriptionStatus(connection, subscription.id, {
            status: subscription.status,
            // Actualizamos la fecha de cobro si ha cambiado
            next_charge_at: new Date(subscription.current_period_end * 1000)
        });

    } catch (error) {
        console.error('Error en handleSubscriptionUpdated:', error);
    } finally {
        connection.release();
    }
}

export async function handleSubscriptionDeleted(dbPool, subscription) {
    console.log('Subscription deleted:', subscription.id);
    // Actualizar en la base de datos
    const connection = await dbPool.getConnection();
    await stripeRepository.cancelSubscriptionInActiveProduct(connection, subscription.product_id);
}

export async function handleInvoicePaymentSucceeded(dbPool, invoice) {
    console.log('--- [WEBHOOK] Procesando Pago ---');

    const connection = await dbPool.getConnection();

    try {
        // 1. BUSCAR EN BD USANDO EL CLIENTE (payer_ref)
        // Sacamos el subscription_id, user_id y el productId (que está en metadata)
        const [rows] = await connection.execute(
            `SELECT subscription_id, user_id, metadata 
             FROM subscriptions 
             WHERE payer_ref = ? AND status = 'incomplete' 
             ORDER BY created_at DESC LIMIT 1`,
            [invoice.customer]
        );

        if (rows.length === 0) {
            console.log('⚠️ No se encontró suscripción pendiente para este cliente.');
            return;
        }

        const { subscription_id, user_id, metadata } = rows[0];
        let productId = null;

        // 2. EXTRAER PRODUCTID DE TU METADATA
        if (metadata) {
            try {
                const meta = JSON.parse(metadata);
                productId = meta.product_id;
            } catch (e) { console.error("Error parseando metadata local"); }
        }

        if (!productId || !user_id) {
            console.error('❌ Faltan datos críticos en la BD local para activar.');
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
            subscription_id: subscription_id,
            centro: invoice.metadata?.centro || null
        });

        console.log(`✅ ¡LISTO! Usuario ${user_id} activado con producto ${productId}`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        connection.release();
    }
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
