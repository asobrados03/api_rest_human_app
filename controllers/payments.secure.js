import crypto from 'crypto';

const TOKENIZE_URL = 'https://remote.sandbox.addonpayments.com/remote/tokenize';

function generateIntegrityCheck(paramMap) {
    const encodedParams = Object.entries(paramMap)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

    const hash = crypto.createHash('sha256');
    hash.update(encodedParams, 'utf8');

    return hash.digest('hex');
}

function encryptParameters(paramMap, secretKeyBytes, ivBytes) {
    const formattedParams = Object.entries(paramMap)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

    const cipher = crypto.createCipheriv('aes-256-cbc', secretKeyBytes, ivBytes);
    let encrypted = cipher.update(formattedParams, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return encrypted;
}

export async function getTokenizedPaymentUrl({
    orderId,
    amount,
    customerEmail,
    customerId
}) {
    const paramMap = {
    merchantId: process.env.ADDON_ID,
    merchantTransactionId: orderId,
    amount: amount.toFixed(2),
    currency: 'EUR',
    country: 'ES',
    paymentSolution: 'creditcards',
    customerId: String(customerId),
    customerEmail,
    successURL: `https://yourapp.com/pago_exitoso`,
    errorURL: `https://yourapp.com/pago_error`,
    cancelURL: `https://yourapp.com/pago_cancelado`,
    statusURL: `https://yourbackend.com/api/payments/status` // opcional
    };

    const integrityCheck = generateIntegrityCheck(paramMap);

    const ivBytes = crypto.randomBytes(16);
    const secretKeyBytes = crypto.createHash('sha256').update(process.env.ADDON_SECRET, 'utf8').digest();

    const encrypted = encryptParameters(paramMap, secretKeyBytes, ivBytes);
    const ivBase64 = ivBytes.toString('base64');

    const formData = new URLSearchParams();
    formData.append('merchantId', process.env.ADDON_ID);
    formData.append('encrypted', encrypted);
    formData.append('integrityCheck', integrityCheck);

    const response = await fetch(TOKENIZE_URL, {
    method: 'POST',
    headers: {
        'apiVersion': '5',
        'encryptionMode': 'CBC',
        'iv': ivBase64,
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData
    });

    if (!response.ok) {
    throw new Error(`Tokenize request failed: ${response.status}`);
    }

    return await response.text();
}
