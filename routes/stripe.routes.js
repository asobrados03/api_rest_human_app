import express, { Router } from 'express';
const router = Router();
import { verifyToken } from '../middlewares/verifyToken.js';
import * as stripeController from '../controllers/stripe.controller.js';

// Inyectar pool de conexión a la request para que el Controller lo pueda usar
router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})


// ==================== WEBHOOKS ====================

/**
 * @route   POST /api/stripe/webhook
 * @desc    Manejar webhook de Stripe
 * @access  public
 * @note    Verificado por Stripe signature. Esta ruta NO debe usar bodyParser.json(), usa express.raw().
 */
router.post('/webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhook);

router.use(express.json());

// ==================== CLIENTES ====================

/**
 * @route   POST /api/stripe/customer
 * @desc    Crear o obtener cliente de Stripe
 * @access  Private
 */
router.post('/customer', verifyToken, stripeController.createCustomer);

/**
 * @route   GET /api/stripe/customer/:customerId
 * @desc    Obtener información del cliente
 * @access  Private
 */
router.get('/customer/:customerId', verifyToken, stripeController.getCustomer);

// ==================== PAYMENT METHODS ====================

/**
 * @route   GET /api/stripe/payment-methods/:customerId
 * @desc    Listar métodos de pago de un cliente
 * @access  Private
 */
router.get('/payment-methods/:customerId', verifyToken, stripeController.listPaymentMethods);

/**
 * @route   DELETE /api/stripe/payment-method/:paymentMethodId
 * @desc    Eliminar método de pago
 * @access  Private
 */
router.delete('/payment-method/:paymentMethodId', verifyToken, stripeController.detachPaymentMethod);

/**
 * @route   PUT /api/stripe/payment-method/default
 * @desc    Establecer método de pago como predeterminado
 * @access  Private
 */
router.put('/payment-method/default', verifyToken, stripeController.setDefaultPaymentMethod);

// ==================== PAYMENT INTENTS ====================

/**
 * @route   POST /api/stripe/payment-intent
 * @desc    Crear Payment Intent
 * @access  Private
 */
router.post('/payment-intents', verifyToken, stripeController.createPaymentIntent);

/**
 * @route   PATCH /api/stripe/payment-intents/:paymentIntentId
 * @desc    Actualizar estado de Payment Intent (confirmed|canceled)
 * @access  Private
 */
router.patch('/payment-intents/:paymentIntentId', verifyToken, stripeController.updatePaymentIntentStatus);


/**
 * @route   PATCH /api/stripe/payment-intents/:paymentIntentId/state
 * @desc    Transición de estado de Payment Intent (confirmed|canceled)
 * @access  Private
 */
router.patch('/payment-intents/:paymentIntentId/state', verifyToken, stripeController.updatePaymentIntentStatus);

/**
 * @route   GET /api/stripe/payment-intents/:paymentIntentId
 * @desc    Obtener Payment Intent
 * @access  Private
 */
router.get('/payment-intents/:paymentIntentId', verifyToken, stripeController.getPaymentIntent);


// ==================== REEMBOLSOS ====================

/**
 * @route   POST /api/stripe/refund
 * @desc    Crear reembolso
 * @access  Private
 */
router.post('/refund', verifyToken, stripeController.createRefund);

// ==================== SUSCRIPCIONES ====================

/**
 * @route   POST /api/stripe/subscription
 * @desc    Crear suscripción
 * @access  Private
 */
router.post('/subscription', verifyToken, stripeController.createSubscription);

/**
 * @route   DELETE /api/stripe/subscription/:subscriptionId
 * @desc    Cancelar suscripción
 * @access  Private
 */
router.delete('/subscription/:subscriptionId', verifyToken, stripeController.cancelSubscription);

/**
 * @route   GET /api/stripe/subscription/:subscriptionId
 * @desc    Obtener suscripción
 * @access  Private
 */
router.get('/subscription/:subscriptionId', verifyToken, stripeController.getSubscription);

// ==================== TRANSACCIONES ====================

/**
 * @route   GET /api/stripe/transactions
 * @desc    Obtener historial de transacciones del usuario
 * @access  Private
 */
router.get('/transactions', verifyToken, stripeController.getUserTransactions);

/**
 * @route   GET /api/stripe/publishable-key
 * @desc    Devolver la STRIPE_PUBLISHABLE_KEY (pública)
 * @access  Public
 */
router.get('/publishable-key', stripeController.getPublishableKey);

router.post('/ephemeral-keys', verifyToken, stripeController.createEphemeralKey);


/**
 * @route   POST /api/stripe/payments/setup-config
 * @desc    Crear configuración para guardar método de pago (Ephemeral Key + SetupIntent)
 * @access  Private
 */
router.post('/payments/setup-config', verifyToken, stripeController.createSetupConfig);

export default router;
