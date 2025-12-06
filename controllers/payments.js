import https from 'https';
import crypto from 'crypto';
import { logActivity } from '../utils/logger.js';
import { ADDON_ID, ADDON_SECRET } from '../config.js';
import { getTokenizedPaymentUrl } from './payments.secure.js';

const MERCHANT_ID = ADDON_ID;
const ACCOUNT = 'internet';
const CURRENCY = 'EUR';
const AUTO_SETTLE_FLAG = '1';


function sha1(input) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');
}

function generarSha1Hash(timestamp, merchantId, orderId, amount, currency, cardNumber, secret) {
  const part1 = `${timestamp}.${merchantId}.${orderId}.${parseInt(amount)}.${currency.toUpperCase()}.${cardNumber}`;
  const part1Hash = sha1(part1);
  const finalString = `${part1Hash}.${secret}`;
  const finalHash = sha1(finalString);

  console.log('[DEBUG] part1_string:', part1);
  console.log('[DEBUG] part1_hash:', part1Hash);
  console.log('[DEBUG] final_string:', finalString);
  console.log('[DEBUG] final_hash:', finalHash);

  return finalHash;
}

export async function initiatePayment(req, res) {
  const { customer_id, product_id, email, billing_street, billing_postal } = req.body;
  const db = req.app.get('db');

  /*if (!billing_street || !billing_postal) {
    return res.status(400).json({
      error: 'Faltan los campos de facturación: billing_street y billing_postal'
    });
  }

  try {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const [rows] = await db.execute(
      `SELECT * FROM active_products
       WHERE customer_id = ? AND product_id = ?
         AND payment_status = 'pending' AND payment_method = 'card'
       ORDER BY created_at DESC LIMIT 1`,
      [customer_id, product_id]
    );

    const record = rows[0];
    if (!record) {
      return res.status(404).json({ error: 'Producto no encontrado o ya pagado' });
    }

    const rawOrderId = record.invoice_number.replace(/[^\w\-]/g, '-');
    const timestampFragment = timestamp.slice(8, 14);
    const orderId = `${rawOrderId}-${timestampFragment}`.slice(0, 45);

    const sanitize = str => str.trim().replace(/\s+/g, ' ');
    const amountInCents = (record.total_amount * 100).toFixed(0);
    const billingStreet = sanitize(billing_street);
    const billingCity = 'Segovia';
    const billingPostal = sanitize(billing_postal);
    const billingCountry = '724';
    const customerEmail = sanitize(email);

    // HPP hash: timestamp.merchantid.orderid.amount.currency
    const signatureInput = [
      timestamp,
      MERCHANT_ID,
      orderId,
      amountInCents,
      CURRENCY
    ].join('.');

    const firstHash = crypto.createHash('sha1').update(signatureInput).digest('hex');
    const finalHash = crypto.createHash('sha1').update(`${firstHash}.${ADDON_SECRET}`).digest('hex').toUpperCase();

    const fields = {
      TIMESTAMP: timestamp,
      MERCHANT_ID,
      ACCOUNT: 'internet',
      ORDER_ID: orderId,
      AMOUNT: amountInCents,
      CURRENCY,
      AUTO_SETTLE_FLAG: '1',
      COMMENT1: 'Mobile Channel',
      HPP_VERSION: '2',
      HPP_CHANNEL: 'ECOM',
      HPP_LANG: 'es',
      HPP_CUSTOMER_EMAIL: customerEmail,
      HPP_BILLING_STREET1: billingStreet,
      HPP_BILLING_CITY: billingCity,
      HPP_BILLING_POSTALCODE: billingPostal,
      HPP_BILLING_COUNTRY: billingCountry,
      HPP_ADDRESS_MATCH_INDICATOR: 'TRUE',
      HPP_CHALLENGE_REQUEST_INDICATOR: 'NO_PREFERENCE',
      MERCHANT_RESPONSE_URL: 'https://tudominio.com/respuesta',
      SHA1HASH: finalHash
    };

    // Devuelve campos listos para ser usados en un <form POST>
    res.json({
      action: 'https://pay.sandbox.realexpayments.com/pay',
      fields
    });

  } catch (error) {
    console.error('❌ Error al generar datos de pago:', error);
    res.status(500).json({ error: 'Error al preparar la solicitud de pago' });
  }*/
 // 🔐 Datos de pago
const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const orderId = `testcard${timestamp.slice(-6)}`;
  const amount = '1000'; // 10.00 €
  const currency = CURRENCY;
  const cardNumber = '4263970000005262'; // tarjeta de test Addon
  const hash = generarSha1Hash(timestamp, MERCHANT_ID, orderId, amount, currency, cardNumber, ADDON_SECRET);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<request timestamp="${timestamp}" type="auth">
  <merchantid>${MERCHANT_ID}</merchantid>
  <account>${ACCOUNT}</account>
  <orderid>${orderId}</orderid>
  <amount currency="${currency}">${amount}</amount>
  <card>
    <number>${cardNumber}</number>
    <expdate>1228</expdate>
    <type>VISA</type>
    <chname>Test User</chname>
    <cvn>
      <number>123</number>
      <presind>1</presind>
    </cvn>
  </card>
  <autosettle flag="1"/>
  <sha1hash>${hash}</sha1hash>
</request>`;

  const options = {
    hostname: 'remote.sandbox.addonpayments.com',
    path: '/remote',
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      'Accept': 'application/xml',
      'Content-Length': Buffer.byteLength(xml)
    }
  };

  const paymentRequest = https.request(options, (addonResponse) => {
    let data = '';

    addonResponse.on('data', (chunk) => {
      data += chunk;
    });

    addonResponse.on('end', () => {
      console.log('✅ Status:', addonResponse.statusCode);
      console.log('✅ Respuesta:', data);
      res.status(200).send(data); // Devuelve al frontend la respuesta XML
    });
  });

  paymentRequest.on('error', (e) => {
    console.error('❌ Error en la petición:', e.message);
    res.status(500).send({ error: e.message });
  });

  paymentRequest.write(xml);
  paymentRequest.end();
}



export async function confirmPayment(req, res) {
    const { ORDER_ID, RESULT } = req.body;

    if (!ORDER_ID || !RESULT) {
        return res.status(400).json({ error: 'Missing payment confirmation data' });
    }

    // Resultado 00 = aprobado
    if (RESULT === '00') {
        const connection = await req.db.getConnection();
        try {
            await connection.execute(`
                UPDATE active_products
                SET payment_status = 'paid', updated_at = NOW()
                WHERE invoice_number = ?
            `, [ORDER_ID]);
        } finally {
            connection.release();
        }
    }

    await logActivity(req, {
        subject: `Addon callback RESULT=${RESULT} for order ${ORDER_ID}`,
    });

    return res.status(200).send('OK');
}

export async function paymentResultRedirect(req, res) {
    const { status } = req.query;

    if (status === 'ok') {
        return res.redirect(`https://${RETURN_URL_BASE}/pago-ok`); 
    } else {
        return res.redirect(`https://${RETURN_URL_BASE}/pago-cancelado`);
    }
}

export async function getClassicPaymentUrl(req, res) {
  const { customer_id, product_id, customer_email, billing_street, billing_postal } = req.body;
  const db = req.app.get('db');

    try {
        const [rows] = await db.execute(
            `SELECT * FROM active_products
             WHERE customer_id = ? AND product_id = ?
               AND payment_status = 'paid' AND payment_method = 'card'
             ORDER BY created_at DESC LIMIT 1`,
            [customer_id, product_id]
        );

    const record = rows[0];
    if (!record) {
      return res.status(404).json({ error: 'Producto no encontrado o ya pagado' });
    }

    const orderId = record.invoice_number.replace(/\//g, '-');
    const amount = (record.total_amount * 100).toFixed(0); // en centavos
    const baseUrl = 'https://hpp.sandbox.addonpayments.com/pay'; // Classic HPP URL

    const paymentUrl = `${baseUrl}?MERCHANT_ID=${process.env.ADDON_ID}` +
      `&ORDER_ID=${orderId}` +
      `&AMOUNT=${amount}` +
      `&CURRENCY=EUR` +
      `&ACCOUNT=internet` +
      `&AUTO_SETTLE_FLAG=1` +
      `&TIMESTAMP=${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}` +
      `&CUSTOMER_EMAIL=${encodeURIComponent(customer_email)}`;

    res.json({ paymentUrl });
  } catch (err) {
    console.error("❌ Error en getClassicPaymentUrl:", err);
    res.status(500).json({ error: 'Error interno al generar URL clásica' });
  }
}
