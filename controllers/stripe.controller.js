import * as stripeService from '../services/stripe.service.js';
import * as stripeRepository from '../repositories/stripe.repository.js';
import stripe from '../config/stripe.config.js';
import { logActivity } from '../utils/logger.js';

import logger from '../utils/pino.js';
// ==================== CLIENTES ====================

/**
 * Crear o obtener cliente de Stripe
 * POST /api/stripe/customer
 */
export async function createCustomer(req, res) {
    try {
        const userId = req.user_payload?.id || req.body.userId; // Asume que el userId viene del JWT o body

        logger.info({ userId }, '[STRIPE] createCustomer iniciado');

        const result = await stripeService.createOrGetCustomer(req.db, userId);

        res.status(200).json({
            success: true,
            message: result.isNew ? 'Cliente creado exitosamente' : 'Cliente obtenido exitosamente',
            data: result
        });

        await logActivity(req, {
            subject: result.isNew
                ? `Stripe: cliente creado para usuario ${userId}`
                : `Stripe: cliente reutilizado para usuario ${userId}`,
            userId: userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (createCustomer)'));
    } catch (error) {
        logger.error({ error }, 'Error en createCustomer');
        res.status(500).json({
            success: false,
            message: 'Error al crear/obtener cliente',
            error: error.message
        });
    }
}

/**
 * Obtener información del cliente
 * GET /api/stripe/customer/:customerId
 */
export async function getCustomer(req, res) {
    try {
        const { customerId } = req.params;

        const customer = await stripeService.getCustomer(customerId);

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        logger.error({ error }, 'Error en getCustomer');
        res.status(500).json({
            success: false,
            message: 'Error al obtener cliente',
            error: error.message
        });
    }
}

// ==================== PAYMENT METHODS ====================

/**
 * Adjuntar método de pago
 * POST /api/stripe/payment-method/attach
 */
export async function attachPaymentMethod(req, res) {
    try {
        const { paymentMethodId, customerId } = req.body;
        logger.info({ customerId, paymentMethodId }, '[STRIPE] attachPaymentMethod iniciado');

        // Validación simple: ahora solo necesitamos estos dos IDs
        if (!paymentMethodId || !customerId) {
            return res.status(400).json({
                success: false,
                message: 'paymentMethodId y customerId son requeridos'
            });
        }

        const paymentMethod = await stripeService.attachPaymentMethod(paymentMethodId, customerId);

        res.status(200).json({
            success: true,
            message: 'Método de pago vinculado correctamente',
            data: paymentMethod
        });

        // Log de actividad actualizado
        await logActivity(req, {
            subject: `Stripe: método de pago ${paymentMethod.id} adjuntado a cliente ${customerId}`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (attachPaymentMethod)'));

    } catch (error) {
        logger.error({ error: error.message }, 'Error en controlador attachPaymentMethod');
        res.status(500).json({
            success: false,
            message: 'Error al vincular el método de pago',
            error: error.message
        });
    }
}

/**
 * Listar métodos de pago
 * GET /api/stripe/payment-methods/:customerId
 */
export async function listPaymentMethods(req, res) {
    try {
        const { customerId } = req.params;

        // 1. Lanzamos ambas peticiones en paralelo para ganar velocidad
        const [customer, paymentMethods] = await Promise.all([
            stripe.customers.retrieve(customerId),
            stripe.paymentMethods.list({ customer: customerId, type: 'card' })
        ]);

        // 2. Extraemos el ID predeterminado (priorizando invoice_settings)
        const defaultId = customer.invoice_settings?.default_payment_method || customer.default_source;

        res.status(200).json({
            success: true,
            data: {
                methods: paymentMethods.data,
                defaultPaymentMethodId: defaultId // Enriquecemos la respuesta
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Eliminar método de pago
 * DELETE /api/stripe/payment-method/:paymentMethodId
 */
export async function detachPaymentMethod(req, res) {
    try {
        const { paymentMethodId } = req.params;
        logger.info('[STRIPE] detachPaymentMethod iniciado', { paymentMethodId });

        const paymentMethod = await stripeService.detachPaymentMethod(paymentMethodId);

        res.status(200).json({
            success: true,
            message: 'Método de pago eliminado exitosamente',
            data: paymentMethod
        });

        await logActivity(req, {
            subject: `Stripe: método de pago ${paymentMethodId} eliminado`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (detachPaymentMethod):'));
    } catch (error) {
        logger.error({ error }, 'Error en detachPaymentMethod:');
        res.status(500).json({
            success: false,
            message: 'Error al eliminar método de pago',
            error: error.message
        });
    }
}

export async function setDefaultPaymentMethod(req, res) {
    try {
        const paymentMethodId = req.body.paymentMethodId || null;
        const userId = req.user_payload?.id || req.body.userId;
        logger.info({ userId, paymentMethodId }, '[STRIPE] setDefaultPaymentMethod iniciado');
        if (!paymentMethodId || !userId) {
            return res.status(400).json({
                success: false,
                message: 'paymentMethodId y userId son requeridos'
            });
        }

        await stripeService.setDefaultPaymentMethod(req.db, paymentMethodId, userId);

        res.status(200).json({
            success: true,
            message: 'Método de pago establecido como predeterminado'
        });

        await logActivity(req, {
            subject: `Stripe: método de pago ${paymentMethodId} establecido como predeterminado para usuario ${userId}`,
            userId: userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (setDefaultPaymentMethod):'));
    } catch (error) {
        logger.error({ error }, 'Error en setDefaultPaymentMethod:');
        res.status(500).json({
            success: false,
            message: 'Error al establecer método de pago predeterminado',
            error: error.message
        });
    }
}

// ==================== PAYMENT INTENTS ====================

/**
 * Crear Payment Intent
 * POST /api/stripe/payment-intent
 */
export async function createPaymentIntent(req, res) {
    try {
        const { amount, currency, customerId, metadata, paymentMethodId } = req.body;
        logger.info('[STRIPE] createPaymentIntent iniciado', { customerId, amount, currency });

        if (!amount || !customerId) {
            return res.status(400).json({
                success: false,
                message: 'amount y customerId son requeridos'
            });
        }

        const paymentIntent = await stripeService.createPaymentIntent({
            amount,
            currency,
            customerId,
            metadata,
            paymentMethodId
        });

        res.status(200).json({
            success: true,
            data: paymentIntent
        });

        await logActivity(req, {
            subject: `Stripe: payment intent creado (${paymentIntent.id}) para cliente ${customerId}`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (createPaymentIntent)'));
    } catch (error) {
        logger.error({ error }, 'Error en createPaymentIntent');
        res.status(500).json({
            success: false,
            message: 'Error al crear Payment Intent',
            error: error.message
        });
    }
}

/**
 * Confirmar Payment Intent
 * POST /api/stripe/payment-intent/:paymentIntentId/confirm
 */
export async function confirmPaymentIntent(req, res) {
    try {
        const { paymentIntentId } = req.params;
        const { paymentMethodId } = req.body;
        logger.info('[STRIPE] confirmPaymentIntent iniciado', { paymentIntentId, paymentMethodId });

        if (!paymentMethodId) {
            return res.status(400).json({
                success: false,
                message: 'paymentMethodId es requerido'
            });
        }

        const paymentIntent = await stripeService.confirmPaymentIntent(paymentIntentId, paymentMethodId);

        res.status(200).json({
            success: true,
            data: paymentIntent
        });

        await logActivity(req, {
            subject: `Stripe: payment intent confirmado (${paymentIntentId})`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (confirmPaymentIntent):'));
    } catch (error) {
        logger.error({ error }, 'Error en confirmPaymentIntent:');
        res.status(500).json({
            success: false,
            message: 'Error al confirmar Payment Intent',
            error: error.message
        });
    }
}

/**
 * Obtener Payment Intent
 * GET /api/stripe/payment-intent/:paymentIntentId
 */
export async function getPaymentIntent(req, res) {
    try {
        const { paymentIntentId } = req.params;

        const paymentIntent = await stripeService.getPaymentIntent(paymentIntentId);

        res.status(200).json({
            success: true,
            data: paymentIntent
        });
    } catch (error) {
        logger.error({ error }, 'Error en getPaymentIntent:');
        res.status(500).json({
            success: false,
            message: 'Error al obtener Payment Intent',
            error: error.message
        });
    }
}

/**
 * Cancelar Payment Intent
 * POST /api/stripe/payment-intent/:paymentIntentId/cancel
 */
export async function cancelPaymentIntent(req, res) {
    try {
        const { paymentIntentId } = req.params;
        logger.info('[STRIPE] cancelPaymentIntent iniciado', { paymentIntentId });

        const paymentIntent = await stripeService.cancelPaymentIntent(paymentIntentId);

        res.status(200).json({
            success: true,
            message: 'Payment Intent cancelado exitosamente',
            data: paymentIntent
        });

        await logActivity(req, {
            subject: `Stripe: payment intent cancelado (${paymentIntentId})`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (cancelPaymentIntent):'));
    } catch (error) {
        logger.error({ error }, 'Error en cancelPaymentIntent:');
        res.status(500).json({
            success: false,
            message: 'Error al cancelar Payment Intent',
            error: error.message
        });
    }
}

// ==================== REEMBOLSOS ====================

/**
 * Crear reembolso
 * POST /api/stripe/refund
 */
export async function createRefund(req, res) {
    try {
        const { paymentIntentId, amount } = req.body;
        logger.info('[STRIPE] createRefund iniciado', { paymentIntentId, amount });

        if (!paymentIntentId) {
            return res.status(400).json({
                success: false,
                message: 'paymentIntentId es requerido'
            });
        }

        const refund = await stripeService.createRefund(paymentIntentId, amount);

        res.status(200).json({
            success: true,
            message: 'Reembolso creado exitosamente',
            data: refund
        });

        await logActivity(req, {
            subject: `Stripe: reembolso creado para payment intent ${paymentIntentId}`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (createRefund):'));
    } catch (error) {
        logger.error({ error }, 'Error en createRefund:');
        res.status(500).json({
            success: false,
            message: 'Error al crear reembolso',
            error: error.message
        });
    }
}

// ==================== SUSCRIPCIONES ====================

/**
 * Crear suscripción
 * POST /api/stripe/subscription
 */
export async function createSubscription(req, res) {
    try {
        const { priceId, userId, productId, couponCode } = req.body;
        logger.info({ userId, productId, priceId, couponCode }, '[STRIPE] createSubscription iniciado');

        if (!priceId || !userId || !productId) {
            return res.status(400).json({
                success: false,
                message: 'priceId, userId y productId son requeridos'
            });
        }

        const subscription = await stripeService.createSubscription(req.db, {
            userId,
            priceId,
            productId,
            couponCode
        });

        res.status(200).json(subscription);

        await logActivity(req, {
            subject: `Stripe: suscripción creada para usuario ${userId} (producto ${productId})`,
            userId: userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (createSubscription):'));
    } catch (error) {
        logger.error({ error }, 'Error en createSubscription:');
        res.status(500).json({
            success: false,
            message: 'Error al crear suscripción',
            error: error.message
        });
    }
}

/**
 * Cancelar suscripción
 * DELETE /api/stripe/subscription/:subscriptionId
 */
export async function cancelSubscription(req, res) {
    try {
        const { subscriptionId } = req.params;
        const userId = req.query.user_id || req.user?.id;
        const productId = req.query.product_id;
        logger.info({ subscriptionId, userId, productId }, '[STRIPE] cancelSubscription iniciado');

        const subscription = await stripeService.cancelSubscription(req.db, subscriptionId, userId, productId);

        res.status(200).json({
            success: true,
            message: 'Suscripción cancelada exitosamente',
            data: subscription
        });

        await logActivity(req, {
            subject: `Stripe: suscripción cancelada (${subscriptionId}) para usuario ${userId}`,
            userId: userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (cancelSubscription):'));
    } catch (error) {
        logger.error({ error }, "❌ Error cancelando suscripción"); // El objeto va primero
        logger.error("Error en cancelSubscription: " + error.message);
        res.status(500).json({
            success: false,
            message: 'Error al cancelar suscripción',
            error: error.message
        });
    }
}

export const createEphemeralKey = async (req, res) => {
    try {
        const { customer_id } = req.body;
        logger.info({ customer_id }, '[STRIPE] createEphemeralKey iniciado');

        if (!customer_id) {
            return res.status(400).json({
                success: false,
                message: 'customer_id es requerido'
            });
        }

        const key = await stripe.ephemeralKeys.create(
            { customer: customer_id },
            { apiVersion: "2026-01-28.clover" }
        );

        res.status(200).json({
            success: true,
            data: key
        });

        await logActivity(req, {
            subject: `Stripe: ephemeral key creada para cliente ${customer_id}`,
            userId: req.user_payload?.id || req.body.userId || null
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (createEphemeralKey):'));
    } catch (error) {
        logger.error({ error }, 'Error en createEphemeralKey:');
        res.status(500).json({
            success: false,
            message: 'Error al crear ephemeral key',
            error: error.message
        });
    }
};

/**
 * Obtener suscripción
 * GET /api/stripe/subscription/:subscriptionId
 */
export async function getSubscription(req, res) {
    try {
        const { subscriptionId } = req.params;

        const subscription = await stripeService.getSubscription(subscriptionId);

        res.status(200).json({
            success: true,
            data: subscription
        });
    } catch (error) {
        logger.error({ error }, 'Error en getSubscription:');
        res.status(500).json({
            success: false,
            message: 'Error al obtener suscripción',
            error: error.message
        });
    }
}

// ==================== TRANSACCIONES ====================

/**
 * Obtener historial de transacciones del usuario
 * GET /api/stripe/transactions
 */
export async function getUserTransactions(req, res) {
    try {
        const userId = req.user?.id || req.query.userId;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId es requerido'
            });
        }

        const transactions = await stripeRepository.getTransactionsByCustomerId(req.db, userId);

        res.status(200).json({
            success: true,
            data: transactions
        });
    } catch (error) {
        logger.error({ error }, 'Error en getUserTransactions:');
        res.status(500).json({
            success: false,
            message: 'Error al obtener transacciones',
            error: error.message
        });
    }
}


export async function createSetupConfig(req, res) {
    try {
        const userId = req.user_payload?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Usuario no autenticado'
            });
        }

        const setupConfig = await stripeService.createSetupConfig(req.db, userId);

        res.status(200).json({
            success: true,
            message: 'Configuración de SetupIntent creada exitosamente',
            data: setupConfig
        });

        await logActivity(req, {
            subject: `Stripe: setup config creada para usuario ${userId}`,
            userId
        }).catch((logErr) => logger.error({ logErr }, '⚠️ Logging error (createSetupConfig):'));
    } catch (error) {
        logger.error({ error }, 'Error en createSetupConfig:');

        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: 'Error al crear configuración de método de pago',
            error: error.message
        });
    }
}

// ==================== WEBHOOKS ====================

/**
 * Manejar webhook de Stripe
 * POST /api/stripe/webhook
 */
export async function handleWebhook(req, res) {
    try {
        const signature = req.headers['stripe-signature'];

        // Verificar la firma del webhook
        const event = stripeService.verifyWebhookSignature(req.body, signature);

        // Procesar el evento
        await stripeService.handleWebhook(req.db, event);

        res.status(200).json({ received: true });
    } catch (error) {
        logger.error({ error }, 'Error en handleWebhook:');
        res.status(400).json({
            success: false,
            message: 'Error al procesar webhook',
            error: error.message
        });
    }
}

/**
 * Obtener STRIPE_PUBLISHABLE_KEY (pública)
 * GET /api/stripe/publishable-key
 * Access Public
 */
export async function getPublishableKey(req, res) {
    try {
        const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

        if (!publishableKey) {
            return res.status(500).json({
                success: false,
                message: 'STRIPE_PUBLISHABLE_KEY no está definida en el entorno'
            });
        }

        res.status(200).json({ publishableKey })

    } catch (error) {
        logger.error({ error }, 'Error en getPublishableKey:');
        res.status(500).json({
            success: false,
            message: 'Error al obtener la clave publishable',
            error: error.message
        });
    }
}
