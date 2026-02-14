import * as stripeService from '../services/stripe.service.js';
import * as stripeRepository from '../repositories/stripe.repository.js';
import stripe from '../config/stripe.config.js';

// ==================== CLIENTES ====================

/**
 * Crear o obtener cliente de Stripe
 * POST /api/stripe/customer
 */
export async function createCustomer(req, res) {
    try {
        const userId = req.user_payload?.id || req.body.userId; // Asume que el userId viene del JWT o body

        const result = await stripeService.createOrGetCustomer(req.db, userId);

        res.status(200).json({
            success: true,
            message: result.isNew ? 'Cliente creado exitosamente' : 'Cliente obtenido exitosamente',
            data: result
        });
    } catch (error) {
        console.error('Error en createCustomer:', error);
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
        console.error('Error en getCustomer:', error);
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

        if (!paymentMethodId || !customerId) {
            return res.status(400).json({
                success: false,
                message: 'paymentMethodId y customerId son requeridos'
            });
        }

        const paymentMethod = await stripeService.attachPaymentMethod(paymentMethodId, customerId);

        res.status(200).json({
            success: true,
            message: 'Método de pago adjuntado exitosamente',
            data: paymentMethod
        });
    } catch (error) {
        console.error('Error en attachPaymentMethod:', error);
        res.status(500).json({
            success: false,
            message: 'Error al adjuntar método de pago',
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

        const paymentMethods = await stripeService.listPaymentMethods(customerId);

        res.status(200).json({
            success: true,
            data: paymentMethods
        });
    } catch (error) {
        console.error('Error en listPaymentMethods:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar métodos de pago',
            error: error.message
        });
    }
}

/**
 * Eliminar método de pago
 * DELETE /api/stripe/payment-method/:paymentMethodId
 */
export async function detachPaymentMethod(req, res) {
    try {
        const { paymentMethodId } = req.params;

        const paymentMethod = await stripeService.detachPaymentMethod(paymentMethodId);

        res.status(200).json({
            success: true,
            message: 'Método de pago eliminado exitosamente',
            data: paymentMethod
        });
    } catch (error) {
        console.error('Error en detachPaymentMethod:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar método de pago',
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
    } catch (error) {
        console.error('Error en createPaymentIntent:', error);
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
    } catch (error) {
        console.error('Error en confirmPaymentIntent:', error);
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
        console.error('Error en getPaymentIntent:', error);
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

        const paymentIntent = await stripeService.cancelPaymentIntent(paymentIntentId);

        res.status(200).json({
            success: true,
            message: 'Payment Intent cancelado exitosamente',
            data: paymentIntent
        });
    } catch (error) {
        console.error('Error en cancelPaymentIntent:', error);
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
    } catch (error) {
        console.error('Error en createRefund:', error);
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
        const { priceId, userId, productId } = req.body;

        if (!priceId || !userId || !productId) {
            return res.status(400).json({
                success: false,
                message: 'priceId, userId y productId son requeridos'
            });
        }

        const subscription = await stripeService.createSubscription(req.db, {
            userId,
            priceId,
            productId
        });

        res.status(200).json(subscription);
    } catch (error) {
        console.error('Error en createSubscription:', error);
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

        const subscription = await stripeService.cancelSubscription(req.db, subscriptionId);

        res.status(200).json({
            success: true,
            message: 'Suscripción cancelada exitosamente',
            data: subscription
        });
    } catch (error) {
        console.error('Error en cancelSubscription:', error);
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
    } catch (error) {
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
        console.error('Error en getSubscription:', error);
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
        console.error('Error en getUserTransactions:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener transacciones',
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
        console.error('Error en handleWebhook:', error);
        res.status(400).json({
            success: false,
            message: 'Error al procesar webhook',
            error: error.message
        });
    }
}

// ==================== TARJETAS ====================

/**
 * Guardar tarjeta en addon_tokens_store
 * POST /api/stripe/cards
 */
export async function saveCard(req, res) {
    try {
        const userId = req.user?.id || req.body.userId;
        const cardData = req.body;

        const dbPool = req.db;
        const connection = await dbPool.getConnection();

        const cardId = await stripeRepository.savePaymentMethod({
            ...cardData,
            connection,
            user_id: userId
        });

        res.status(201).json({
            success: true,
            message: 'Tarjeta guardada exitosamente',
            data: { cardId }
        });
    } catch (error) {
        console.error('Error en saveCard:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar tarjeta',
            error: error.message
        });
    }
}

/**
 * Obtener tarjetas del usuario
 * GET /api/stripe/cards
 */
export async function getUserCards(req, res) {
    try {
        const userId = req.user?.id || req.query.userId;

        const dbPool = req.db;
        const connection = await dbPool.getConnection();

        const cards = await stripeRepository.getPaymentMethodsByUserId(connection, userId);

        res.status(200).json({
            success: true,
            data: cards
        });
    } catch (error) {
        console.error('Error en getUserCards:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener tarjetas',
            error: error.message
        });
    }
}

/**
 * Eliminar tarjeta
 * DELETE /api/stripe/cards/:cardId
 */
export async function deleteCard(req, res) {
    try {
        const userId = req.user?.id || req.body.userId;
        const { cardId } = req.params;

        const dbPool = req.db;
        const connection = await dbPool.getConnection();

        await stripeRepository.deletePaymentMethod(connection, cardId, userId);

        res.status(200).json({
            success: true,
            message: 'Tarjeta eliminada exitosamente'
        });
    } catch (error) {
        console.error('Error en deleteCard:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar tarjeta',
            error: error.message
        });
    }
}

/**
 * Establecer tarjeta como predeterminada
 * PUT /api/stripe/cards/:cardId/default
 */
export async function setDefaultCard(req, res) {
    try {
        const userId = req.user?.id || req.body.userId;
        const { cardId } = req.params;

        const dbPool = req.db;
        const connection = await dbPool.getConnection();

        await stripeRepository.setDefaultPaymentMethod(connection, cardId, userId);

        res.status(200).json({
            success: true,
            message: 'Tarjeta establecida como predeterminada'
        });
    } catch (error) {
        console.error('Error en setDefaultCard:', error);
        res.status(500).json({
            success: false,
            message: 'Error al establecer tarjeta predeterminada',
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
        console.error('Error en getPublishableKey:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener la clave publishable',
            error: error.message
        });
    }
}
