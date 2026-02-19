export const DEFAULT_CURRENCY = 'eur';

export const toCents = (amount) => {
    return Math.round(amount * 100);
};

export const fromCents = (cents) => {
    return cents / 100;
};

export const formatCardDisplay = (card) => {
    return {
        id: card.id,
        brand: card.card?.brand || card.brand_reference,
        last4: card.card?.last4 || card.masked_pan?.slice(-4),
        expMonth: card.card?.exp_month || Math.floor(card.exp_date / 100),
        expYear: card.card?.exp_year || (2000 + (card.exp_date % 100)),
        isDefault: card.is_default || false
    };
};

export const validateAmount = (amount) => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('El monto debe ser un número positivo');
    }
    return numAmount;
};

export const createStripeMetadata = (data) => {
    const metadata = {};

    Object.keys(data).forEach(key => {
        // Stripe solo acepta strings en metadata
        metadata[key] = String(data[key]);
    });

    return metadata;
};
