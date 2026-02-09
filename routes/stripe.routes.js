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
 * @route   POST /api/stripe/payment-method/attach
 * @desc    Adjuntar método de pago a un cliente
 * @access  Private
 */
router.post('/payment-method/attach', verifyToken, stripeController.attachPaymentMethod);

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

// ==================== PAYMENT INTENTS ====================

/**
 * @route   POST /api/stripe/payment-intent
 * @desc    Crear Payment Intent
 * @access  Private
 */
router.post('/payment-intent', verifyToken, stripeController.createPaymentIntent);

/**
 * @route   POST /api/stripe/payment-intent/:paymentIntentId/confirm
 * @desc    Confirmar Payment Intent
 * @access  Private
 */
router.post('/payment-intent/:paymentIntentId/confirm', verifyToken, stripeController.confirmPaymentIntent);

/**
 * @route   GET /api/stripe/payment-intent/:paymentIntentId
 * @desc    Obtener Payment Intent
 * @access  Private
 */
router.get('/payment-intent/:paymentIntentId', verifyToken, stripeController.getPaymentIntent);

/**
 * @route   POST /api/stripe/payment-intent/:paymentIntentId/cancel
 * @desc    Cancelar Payment Intent
 * @access  Private
 */
router.post('/payment-intent/:paymentIntentId/cancel', verifyToken, stripeController.cancelPaymentIntent);

// ==================== COMPRA DE PRODUCTO ====================

/**
 * @route   POST /api/stripe/purchase
 * @desc    Procesar compra de producto
 * @access  Private
 */
router.post('/purchase', verifyToken, stripeController.purchaseProduct);

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

// ==================== TARJETAS ====================

/**
 * @route   POST /api/stripe/cards
 * @desc    Guardar tarjeta
 * @access  Private
 */
router.post('/cards', verifyToken, stripeController.saveCard);

/**
 * @route   GET /api/stripe/cards
 * @desc    Obtener tarjetas del usuario
 * @access  Private
 */
router.get('/cards', verifyToken, stripeController.getUserCards);

/**
 * @route   DELETE /api/stripe/cards/:cardId
 * @desc    Eliminar tarjeta
 * @access  Private
 */
router.delete('/cards/:cardId', verifyToken, stripeController.deleteCard);

/**
 * @route   PUT /api/stripe/cards/:cardId/default
 * @desc    Establecer tarjeta como predeterminada
 * @access  Private
 */
router.put('/cards/:cardId/default', verifyToken, stripeController.setDefaultCard);

/**
 * @route   GET /api/stripe/publishable-key
 * @desc    Devolver la STRIPE_PUBLISHABLE_KEY (pública)
 * @access  Public
 */
router.get('/publishable-key', stripeController.getPublishableKey);

router.post('/ephemeral-keys', verifyToken, stripeController.createEphemeralKey);

export default router;