/**
 * Utilidades para trabajar con Stripe
 */

/**
 * Convertir monto a centavos (Stripe trabaja con centavos)
 */
const toCents = (amount) => {
    return Math.round(amount * 100);
};

/**
 * Convertir centavos a monto decimal
 */
const fromCents = (cents) => {
    return cents / 100;
};

/**
 * Generar número de factura único
 */
const generateInvoiceNumber = () => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `INV-${timestamp}-${random}`;
};

/**
 * Calcular fecha de expiración según tipo de producto
 */
const calculateExpiryDate = (productType) => {
    const purchaseDate = new Date();
    let expiryDate = null;

    switch (productType) {
        case 'recurrent':
            // Suscripciones expiran en 1 mes
            expiryDate = new Date(purchaseDate);
            expiryDate.setMonth(expiryDate.getMonth() + 1);
            break;

        case 'multi_sessions':
        case 'single_session':
            // Bonos expiran en 3 meses
            expiryDate = new Date(purchaseDate);
            expiryDate.setMonth(expiryDate.getMonth() + 3);
            break;

        default:
            expiryDate = null;
    }

    return expiryDate;
};

/**
 * Formatear tarjeta para mostrar
 */
const formatCardDisplay = (card) => {
    return {
        id: card.id,
        brand: card.card?.brand || card.brand_reference,
        last4: card.card?.last4 || card.masked_pan?.slice(-4),
        expMonth: card.card?.exp_month || Math.floor(card.exp_date / 100),
        expYear: card.card?.exp_year || (2000 + (card.exp_date % 100)),
        isDefault: card.is_default || false
    };
};

/**
 * Validar monto
 */
const validateAmount = (amount) => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('El monto debe ser un número positivo');
    }
    return numAmount;
};

/**
 * Formatear error de Stripe para mostrar al usuario
 */
const formatStripeError = (error) => {
    const errorMessages = {
        'card_declined': 'Tu tarjeta fue rechazada. Por favor, intenta con otra tarjeta.',
        'insufficient_funds': 'Fondos insuficientes. Por favor, intenta con otra tarjeta.',
        'expired_card': 'Tu tarjeta ha expirado. Por favor, intenta con otra tarjeta.',
        'incorrect_cvc': 'El código CVC es incorrecto. Por favor, verifica e intenta de nuevo.',
        'processing_error': 'Ocurrió un error al procesar el pago. Por favor, intenta de nuevo.',
        'rate_limit': 'Demasiadas solicitudes. Por favor, espera un momento e intenta de nuevo.'
    };

    return errorMessages[error.code] || 'Ocurrió un error al procesar el pago. Por favor, intenta de nuevo.';
};

/**
 * Crear metadata para Stripe
 */
const createStripeMetadata = (data) => {
    const metadata = {};

    Object.keys(data).forEach(key => {
        // Stripe solo acepta strings en metadata
        metadata[key] = String(data[key]);
    });

    return metadata;
};

exports = {
    toCents,
    fromCents,
    generateInvoiceNumber,
    calculateExpiryDate,
    formatCardDisplay,
    validateAmount,
    formatStripeError,
    createStripeMetadata
};