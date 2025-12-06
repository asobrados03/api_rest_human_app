import crypto from 'crypto';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const MERCHANT_ID = process.env.MERCHANT_ID;
const SECRET = process.env.SECRET;
const MERCHANT_ID_S = process.env.MERCHANT_ID_S;
const SECRET_S = process.env.SECRET_S;

const HPP_URL = 'https://hpp.addonpayments.com/pay'; 

const CARD_API_URL = 'https://api.realexpayments.com/epage-remote.cgi';

const CARD_APIGOOGLE_URL = 'https://api.realexpayments.com/epage-remote.cgi';


function createSha1Hash(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

function generateTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function generateOrderId() {
  const now = Date.now(); // or performance.now() if needed
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
  return 'ORD-' + now + '-' + rand;
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return str;

  // 1. Intentar convertir a UTF-8 desde Latin1 o binary si viene mal codificado
  try {
    const buf = Buffer.from(str, 'binary');
    const utf8 = buf.toString('utf8');
    if ((utf8.match(/\?/g) || []).length > 1 || /Ã|Â/.test(utf8)) {
      str = Buffer.from(str, 'latin1').toString('utf8');
    } else {
      str = utf8;
    }
  } catch {
    // ignorar errores
  }

  // 2. Normalizar tildes: "é" -> "e", "ñ" -> "n"
  str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // elimina acentos

  // 3. Eliminar caracteres especiales no permitidos por Addon (como #, º, ª, etc.)
  str = str.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ ,.\-]/g, '');

  // 4. Reemplazar múltiples espacios por uno y recortar
  str = str.replace(/\s+/g, ' ').trim();

  return str;
}

export async function generateHppUrl(req, res) {
  const {
    amount,
    currency,
    firstName,
    lastName,
    email,
    street,
    city,
    postalCode,
    card_storage,        // 'true' para guardar tarjeta nueva
    payer_ref,           // identificador del payer
    select_stored_cards,
    subscribe,            // 'true' → crear suscripción tras HPP OK
    product_id,           // id de plan/producto
    interval_months      
  } = req.query || {};

  // Sanitizar entradas del usuario
  const safe = {
    amount: amount,
    currency: sanitizeInput(currency),
    firstName: sanitizeInput(firstName),
    lastName: sanitizeInput(lastName),
    email: email,
    street: sanitizeInput(street),
    city: sanitizeInput(city),
    postalCode: sanitizeInput(postalCode),
    card_storage: card_storage,
    payer_ref: payer_ref,
    select_stored_cards: select_stored_cards,
    subscribe: subscribe,
    product_id: product_id,
    interval_months: interval_months
  };

  console.log('[HPP] 🌐 URL completa:', req.originalUrl || req.url);
  console.log('[HPP] ⬅️ Parámetros recibidos:', safe);

  if (safe.amount == null || !safe.currency) {
    console.warn('[HPP] ⚠️ Falta amount o currency');
    return res.status(400).json({ error: 'Faltan parámetros: amount y currency' });
  }

  if (!safe.firstName || !safe.lastName || !safe.email || !safe.street || !safe.city || !safe.postalCode) {
    console.warn('[HPP] ⚠️ Faltan datos de facturación');
    return res.status(400).json({ error: 'Faltan datos de facturación obligatorios' });
  }

  let connection;
  try {
    connection = await req.db?.getConnection?.();

    const timestamp = generateTimestamp();
    const orderId = generateOrderId();

    let paymentMethod = '';
    const payerRef = safe.payer_ref;
    const storeCard = safe.card_storage === 'true';
    const showStoredCards = safe.select_stored_cards === 'true';

    if (storeCard && payerRef && connection && showStoredCards) {
      const [rows] = await connection.query(
        'SELECT token FROM addon_tokens_store WHERE payer_ref = ? LIMIT 1',
        [payerRef]
      );
      paymentMethod = rows?.[0]?.token ?? '';
    }

    let merchantId = MERCHANT_ID;
    let secret = SECRET;
    
    if (safe.subscribe === 'true') {
      merchantId = MERCHANT_ID_S;
      secret = SECRET_S;
    }

    const hashString = `${timestamp}.${merchantId}.${orderId}.${safe.amount}.${safe.currency}.${payerRef ?? ''}.${paymentMethod}`;
    const hash1 = createSha1Hash(hashString);
    const sha1hash = createSha1Hash(`${hash1}.${secret}`);

    console.log('[HPP] 🧮 Hash inputs:', {
      timestamp,
      merchantId,
      orderId,
      amount: safe.amount,
      currency: safe.currency,
      payerRef,
      paymentMethod,
      hash1,
      sha1hash
    });

    const responseUrl = new URL('https://apihuman.fransdata.com/api/payments/hpp-response');

    if (safe.subscribe === 'true') {
      responseUrl.searchParams.set('subscribe', '1');
      if (safe.product_id) {
        responseUrl.searchParams.set('product_id', String(safe.product_id));
        responseUrl.searchParams.set('interval_months', String(Number(safe.interval_months || 1)));
      }
    }

    const billingCountry = '724'; // España
    const fields = {
      MERCHANT_ID: merchantId,
      ORDER_ID: orderId,
      AMOUNT: safe.amount,
      CURRENCY: safe.currency,
      TIMESTAMP: timestamp,
      AUTO_SETTLE_FLAG: '1',
      SHA1HASH: sha1hash,
      RETURN_TSS: '1',
      MERCHANT_RESPONSE_URL: responseUrl.toString(),
      HPP_BILLING_STREET1: safe.street,
      HPP_BILLING_CITY: safe.city,
      HPP_BILLING_POSTALCODE: safe.postalCode,
      HPP_BILLING_COUNTRY: billingCountry,
      HPP_CUSTOMER_FIRSTNAME: safe.firstName,
      HPP_CUSTOMER_LASTNAME: safe.lastName,
      HPP_CUSTOMER_EMAIL: safe.email,
      HPP_LANG: "es"
    };

    if (storeCard && payerRef) {
      fields['CARD_STORAGE_ENABLE'] = '1';
      fields['OFFER_SAVE_CARD'] = '1';
      fields['RETURN_CARD_STORAGE'] = '1';
      fields['PAYER_REF'] = payerRef;
      fields['PAYER_EXIST'] = '1';
    } else if (showStoredCards && payerRef) {
      fields['HPP_SELECT_STORED_CARD'] = payerRef;
      fields['PAYER_EXIST'] = '1';
      fields['OFFER_SAVE_CARD'] = '1';
      fields['RETURN_CARD_STORAGE'] = '1';
      fields['PMT_REF'] = paymentMethod;
    } else if (!storeCard && payerRef && paymentMethod) {
      fields['PAYER_REF'] = payerRef;
      fields['PMT_REF'] = paymentMethod;
      fields['PAYER_EXIST'] = '1';
    } else if (!storeCard && payerRef && !paymentMethod) {
      console.warn('[HPP] No hay token asociado a payer_ref y no se solicitó mostrar la lista');
      return res.status(400).json({
        error:
          'No hay tarjeta guardada asociada a este payer_ref. ' +
          'Pasa select_stored_cards=true para elegir una en la HPP o usa card_storage=true para guardar una.'
      });
    }

    console.log('[HPP] Campos que se enviarán a Addon:', fields);

    let html = `<html><body onload="document.forms[0].submit()">`;
    html += `<form method="POST" action="${HPP_URL}">`;

    for (const [key, value] of Object.entries(fields)) {
      html += `<input type="hidden" name="${key}" value="${String(value)}" />\n`;
    }

    html += `</form></body></html>`;
    res.send(html);

  } catch (err) {
    console.error('❌ Error generando HPP URL:', err);
    res.status(500).json({ error: 'Error interno generando formulario de pago' });
  } finally {
    if (connection) connection.release?.();
  }
}

export async function handleHppResponse(req, res) {
  let connection;
  try {
    console.log('BODY recibido:', {
      ...req.body
    });

    // Usar el mismo secreto que en generateHppUrl (depende de si es suscripción)
    let secret = SECRET;
    let merchantId = MERCHANT_ID;
    if (req.query?.subscribe === '1' || req.query?.subscribe === 'true') {
      secret = SECRET_S;
      merchantId = MERCHANT_ID_S;
    }

    const timestamp = req.body.TIMESTAMP || generateTimestamp();
    const ORDER_ID = req.body.ORDER_ID || generateOrderId();
    const RESULT = req.body.RESULT || 'XX';
    const MESSAGE = req.body.MESSAGE || '';
    const PASREF = req.body.PASREF || '';
    const AUTHCODE = req.body.AUTHCODE || '';
    const SHA1HASH = req.body.SHA1HASH || '';
    const AMOUNT = req.body.AMOUNT || '0';
    const CURRENCY = req.body.CURRENCY || 'EUR';
    const PAYER_REF = req.body.PAYER_REF || '';
    const SAVED_PAYER_REF = req.body.SAVED_PAYER_REF || '';
    const SAVED_PMT_REF = req.body.SAVED_PMT_REF || '';
    const HPP_CHOSEN_PMT_REF = req.body.HPP_CHOSEN_PMT_REF || '';
    const SRD = req.body.SRD || '';

    const toHash = `${timestamp}.${merchantId}.${ORDER_ID}.${RESULT}.${MESSAGE}.${PASREF}.${AUTHCODE}`;
    const hash1 = createSha1Hash(toHash);
    const expectedHash = createSha1Hash(`${hash1}.${secret}`);

    if (expectedHash !== SHA1HASH) {
      return res.status(403).json({ error: 'Firma inválida: posible manipulación' });
    }

    console.log('BODY recibido completo:', req.body);
    console.log('QUERY recibido completo:', req.query);
    
    let effectiveUserId = null;
    let effectivePayerRef = null;
    let effectivePmtRef = null;

    if (SAVED_PAYER_REF && SAVED_PMT_REF) {
      const userId = await obtenerUserIdDesdePayerRef(SAVED_PAYER_REF);
      const payerRef = SAVED_PAYER_REF;
      const token = SAVED_PMT_REF;
      const type = req.body.SAVED_PMT_TYPE || null;
      const digits = req.body.SAVED_PMT_DIGITS || null;
      //const brandReference = req.body.SAVED_PMT_BRAND || null;
      // Enmascara los dígitos dejando solo los últimos 4 visibles
      const maskedDigits = digits.replace(/^.{6}/, "xxxxxx");
      const brandReference = SRD || null;
      const exp = req.body.SAVED_PMT_EXPDATE || null;

      if (!req.db) {
        console.error('❌ No hay conexión DB en req.db');
        return res.status(500).send('Error interno: sin acceso a base de datos');
      }

      connection = await req.db.getConnection();

      const query = `
        INSERT INTO addon_tokens_store (user_id, payer_ref, token, brand_reference, card_type, masked_pan, exp_date)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            token=VALUES(token),
            brand_reference=VALUES(brand_reference),
            card_type=VALUES(card_type),
            masked_pan=VALUES(masked_pan),
            exp_date=VALUES(exp_date)
        `;
      await connection.execute(query, [userId, payerRef, token, brandReference, type, maskedDigits, exp]);
      effectiveUserId = userId;
      effectivePayerRef = payerRef;
      effectivePmtRef = token;

    }  else if (HPP_CHOSEN_PMT_REF) {
        // caso: eligió tarjeta ya guardada en HPP
        effectivePmtRef = HPP_CHOSEN_PMT_REF;
        effectivePayerRef = PAYER_REF || null;

        // si tenemos payer_ref, obtenemos user_id
        if (effectivePayerRef) {
          effectiveUserId = await obtenerUserIdDesdePayerRef(effectivePayerRef);
        }

        // si no vino payer_ref, buscamos en DB por token
        if (!effectiveUserId && req.db) {
          connection = connection || await req.db.getConnection();
          const [rows] = await connection.query(
            'SELECT user_id, payer_ref FROM addon_tokens_store WHERE token = ? LIMIT 1',
            [effectivePmtRef]
          );
          if (rows?.length) {
            effectiveUserId = rows[0].user_id;
            effectivePayerRef = rows[0].payer_ref;
          }
        }

      } else {
        console.warn("⚠️ No se devolvió token (ni nuevo ni elegido)");
      }

    const wantSubscribe = req.query?.subscribe === '1' || req.query?.subscribe === 'true';
    if (RESULT === '00' && wantSubscribe) {
      // interval_months con default a 1
      const intervalMonths = Number(req.query?.interval_months || 1);
      const productId = req.query?.product_id ? Number(req.query.product_id) : null;

      // importe y moneda de la propia HPP
      const subAmountMinor = Number(AMOUNT);
      const subCurrency = CURRENCY || 'EUR';

      // si no hay conexión aún (p.ej. no hubo guardado), ábrela ahora
      if (!req.db) {
        console.error('❌ No hay conexión DB en req.db (suscripción)');
        return res.status(500).send('Error interno: sin acceso a base de datos (suscripción)');
      }
      connection = connection || await req.db.getConnection();

      // Validar que tenemos los datos críticos
      if (effectiveUserId && effectivePayerRef && effectivePmtRef && Number.isFinite(subAmountMinor)) {
        // 1 del mes siguiente a las 08:00
        const firstOfNextMonthAt = (hour = 8, minute = 0) => {
          const now = new Date();
          const y = now.getFullYear();
          const m = now.getMonth() + 1;
          return new Date(y + Math.floor(m / 12), m % 12, 1, hour, minute, 0, 0);
        };
        const nextChargeAt = firstOfNextMonthAt(8, 0);

        const insertSub = `
          INSERT INTO subscriptions
            (user_id, payerref, paymentmethod, amount_minor, currency, interval_months, start_date, next_charge_at, status, order_prefix, last_result)
          VALUES
            (?, ?, ?, ?, ?, ?, NOW(), ?, 'active', ?, JSON_OBJECT('hpp_orderid', ?, 'hpp_pasref', ?))
          ON DUPLICATE KEY UPDATE
            amount_minor     = VALUES(amount_minor),
            currency         = VALUES(currency),
            interval_months  = VALUES(interval_months),
            next_charge_at   = VALUES(next_charge_at),
            status           = 'active',
            last_result      = VALUES(last_result)
        `;
        await connection.execute(insertSub, [
          effectiveUserId,
          effectivePayerRef,
          effectivePmtRef,
          subAmountMinor,
          subCurrency,
          intervalMonths,
          nextChargeAt,
          `sub_${effectiveUserId}_${productId || 'na'}`,
          ORDER_ID,
          PASREF || null
        ]);

        console.log('[HPP→SUB] ✅ Suscripción creada/activada', {
          userId: effectiveUserId,
          payerRef: effectivePayerRef,
          pmtRef: effectivePmtRef,
          amountMinor: subAmountMinor,
          currency: subCurrency,
          intervalMonths,
          nextChargeAt
        });
      } else {
        console.warn('[HPP→SUB] Falta info para crear suscripción', {
          effectiveUserId, effectivePayerRef, effectivePmtRef, subAmountMinor, subCurrency
        });
      }
    }

    if (RESULT === "00") {
      res.send(`
        <html>
          <body>
            <p style="color:green">Pago aprobado. ¡Gracias!</p>
            <script>
              // Avisamos al parent (tu iframe de React)
              window.parent.postMessage("payment_success", "*");
            </script>
          </body>
        </html>
      `);
    } else {
      res.send(`
        <html>
          <body>
            <p style="color:red">Pago fallido o cancelado</p>
            <script>
              window.parent.postMessage("payment_failed", "*");
            </script>
          </body>
        </html>
      `);
    }
  } catch (err) {
    console.error('❌ Error procesando respuesta HPP:', err);
    res.status(500).send('Error interno procesando respuesta de pago');
  } finally {
    if (connection) connection.release?.();
  }
}

export async function obtenerUserIdDesdePayerRef(payerRef) {
  try {
    // Validar y extraer el número después de "user_"
    const match = payerRef.match(/^user_(\d+)$/);
    if (!match || !match[1]) {
      console.warn('❗ payer_ref no válido:', payerRef);
      return null;
    }

    const userId = parseInt(match[1], 10);
    if (isNaN(userId)) {
      console.warn('❗ No se pudo extraer user_id de:', payerRef);
      return null;
    }

    return userId;
  } catch (err) {
    console.error('❌ Error extrayendo user_id desde payer_ref:', err);
    return null;
  }
}

// Endpoint handler
export async function runReceiptIn({
  amountMinor,
  currency,
  payerref,
  paymentmethod,     // PMT_REF (token de tarjeta)
  srd,               // brand_reference opcional (mejora aceptación)
  account = "internet",
  channel = "ECOM",
  autosettle = "1"
}) {
  const timestamp = generateTimestamp();
  const orderId = generateOrderId();

  const base = `${timestamp}.${MERCHANT_ID}.${orderId}.${amountMinor}.${currency}.${payerref}`;
  const sha1 = createSha1Hash(base);
  const sha1hash = createSha1Hash(`${sha1}.${SECRET}`);

  const storedCred = srd
    ? `
  <storedcredential>
    <type>RECURRING</type>
    <initiator>MERCHANT</initiator>
    <sequence>SUBSEQUENT</sequence>
    <srd>${srd}</srd>
  </storedcredential>`
    : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<request type="receipt-in" timestamp="${timestamp}">
  <merchantid>${MERCHANT_ID}</merchantid>
  <account>${account}</account>
  <channel>${channel}</channel>
  <orderid>${orderId}</orderid>
  <amount currency="${currency}">${amountMinor}</amount>
  <autosettle flag="${autosettle}"/>
  <payerref>${payerref}</payerref>
  <paymentmethod>${paymentmethod}</paymentmethod>
  ${storedCred}
  <sha1hash>${sha1hash}</sha1hash>
</request>`.trim();

  console.log("[receipt-in] ▶️ XML:\n", xml);

  const resp = await axios.post(CARD_API_URL, xml, {
    headers: { "Content-Type": "application/xml" },
    responseType: "text",
    timeout: 30000,
    validateStatus: () => true
  });

  const body = String(resp.data || "");
  console.log("[receipt-in] ⬅️ status:", resp.status);
  console.log("[receipt-in] ⬇️ body (1k):\n", body.slice(0, 1000));

  // Parse básico
  const take = (re) => (body.match(re) || [])[1] || null;
  const result   = take(/<result>([^<]+)<\/result>/i);
  const message  = take(/<message>([^<]+)<\/message>/i);
  const pasref   = take(/<pasref>([^<]+)<\/pasref>/i);
  const authcode = take(/<authcode>([^<]+)<\/authcode>/i);
  const rTs      = take(/<response timestamp="([^"]+)">/i);
  const rSha     = take(/<sha1hash>([^<]+)<\/sha1hash>/i);
  const ok       = result === "00";

  return {
    ok,
    httpStatus: resp.status,
    orderId,
    result,
    message,
    pasref,
    authcode,
    raw: body
  };
}

export async function processGooglePay(req, res) {
  try {
    console.log("📥 Petición recibida en processGooglePay");
    console.log("👉 Body original:", req.body);

    let { token, amount, currency } = req.body;

    if (!token || !amount || !currency) {
      return res.status(400).json({ error: "Missing token, amount or currency" });
    }

    const timestamp = generateTimestamp();
    const orderId = generateOrderId();

    const hashBase = `${timestamp}.${MERCHANT_ID}.${orderId}.${amount}.${currency}.${token}`;
    const hash1 = createSha1Hash(hashBase);
    const sha1hash = createSha1Hash(`${hash1}.${SECRET}`);

    const xmlRequest = `
      <request timestamp="${timestamp}" type="auth-mobile">
        <merchantid>${MERCHANT_ID}</merchantid>
        <account>internet</account>
        <orderid>${orderId}</orderid>
        <mobile>pay-with-google</mobile>
        <amount currency="${currency}">${amount}</amount>
        <token>${token}</token>
        <autosettle flag="1"/>
        <sha1hash>${sha1hash}</sha1hash>
      </request>
    `.trim();

    console.log("🟡 XML generado:\n", xmlRequest);

    const response = await axios.post(
      "https://api.realexpayments.com/epage-remote.cgi",
      xmlRequest,
      { headers: { "Content-Type": "text/xml" } }
    );

    console.log("🟢 Respuesta Addon:", response.data);

    // Devuelve tal cual al cliente (la app lo interpreta)
    res.set("Content-Type", "text/xml");
    res.send(response.data);
  } catch (err) {
    console.error("❌ Error procesando Google Pay:", err.response?.data || err.message);
    res.status(500).json({
      error: "Error interno procesando Google Pay",
      detail: err.response?.data || err.message,
    });
  }
}

export async function deleteStoredCard(req, res) {
  const userId = parseInt(req.query.user_id, 10);
  const methodId = parseInt(req.query.method_id, 10);

  if (isNaN(userId) || isNaN(methodId)) {
    return res.status(400).json({ error: "Parámetros inválidos" });
  }

  try {
    const [result] = await req.db.execute(
      `UPDATE addon_tokens_store 
       SET deleted_at = NOW() 
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [methodId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Tarjeta no encontrada o ya eliminada" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error eliminando tarjeta:", err);
    res.status(500).json({ error: "Error interno eliminando tarjeta" });
  }
}

export async function setDefaultCard(req, res) {
  const userId = parseInt(req.body.user_id, 10);
  const methodId = parseInt(req.body.method_id, 10);

  if (isNaN(userId) || isNaN(methodId)) {
    return res.status(400).json({ error: "Parámetros inválidos" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // Primero ponemos todas en 0
    await connection.execute(
      `UPDATE addon_tokens_store 
       SET is_default = 0 
       WHERE user_id = ? AND deleted_at IS NULL`,
      [userId]
    );

    // Ahora marcamos la seleccionada en 1
    const [result] = await connection.execute(
      `UPDATE addon_tokens_store 
       SET is_default = 1 
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [methodId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Tarjeta no encontrada o eliminada" });
    }

    res.json({ success: true, id: methodId });
  } catch (err) {
    console.error("❌ Error estableciendo tarjeta predeterminada:", err);
    res.status(500).json({ error: "Error interno estableciendo predeterminada" });
  } finally {
    if (connection) connection.release();
  }
}

export async function listPaymentMethods(req, res) {
  const userId   = req.query.user_id ? Number(req.query.user_id) : null;
  const payerRef = req.query.payer_ref || (userId ? `user_${userId}` : null);

  if (!userId && !payerRef) {
    return res.status(400).json({ error: 'Debe enviar user_id (o payer_ref)' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const sql = payerRef
      ? `SELECT id, user_id, payer_ref, token, masked_pan, exp_date, card_type, created_at, is_default
           FROM addon_tokens_store
          WHERE payer_ref = ?
            AND deleted_at IS NULL
          ORDER BY created_at DESC`
      : `SELECT id, user_id, payer_ref, token, masked_pan, exp_date, card_type, created_at, is_default
           FROM addon_tokens_store
          WHERE user_id = ?
            AND deleted_at IS NULL
          ORDER BY created_at DESC`;

    const [rows] = await connection.query(sql, [payerRef ?? userId]);

    const methods = rows.map(r => {
      const last4 = (r.masked_pan && typeof r.masked_pan === "string")
        ? r.masked_pan.slice(-4)
        : null;

      // exp_date puede ser "MMYY" o "MMYYYY"
      const raw = String(r.exp_date ?? "");
      let exp_month = null, exp_year = null;
      if (/^\d{4}$/.test(raw)) {
        exp_month = parseInt(raw.slice(0, 2), 10);
        exp_year  = 2000 + parseInt(raw.slice(2, 4), 10);
      } else if (/^\d{6}$/.test(raw)) {
        exp_month = parseInt(raw.slice(0, 2), 10);
        exp_year  = parseInt(raw.slice(2, 6), 10);
      }

      return {
        id: r.id,
        provider: "addon",
        payer_ref: r.payer_ref,
        pmt_ref: r.token,           // PMT_REF para rebill
        brand: r.card_type || null, // VISA/MC/…
        last4,
        exp_month,
        exp_year,
        created_at: r.created_at,
        is_default: r.is_default === 1   // ahora usamos la columna real
      };
    });

    return res.json(methods);
  } catch (e) {
    console.error("❌ listPaymentMethods:", e);
    return res.status(500).json({ error: "No se pudieron obtener los métodos" });
  } finally {
    connection?.release?.();
  }
}

export async function listUserPaymentMethods(req, res) {
  const userId = parseInt(req.query.user_id, 10);
  if (isNaN(userId)) {
    return res.status(400).json({ error: "user_id inválido" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // Tarjetas guardadas
    const [cards] = await connection.query(
      `SELECT id, user_id, payer_ref, token, masked_pan, exp_date, card_type, created_at
         FROM addon_tokens_store
        WHERE user_id = ?
        ORDER BY created_at DESC`,
      [userId]
    );

    const cardMethods = cards.map((r, idx) => {
      const last4 = r.masked_pan ? r.masked_pan.slice(-4) : null;
      const raw = String(r.exp_date ?? "");
      let exp_month = null, exp_year = null;
      if (/^\d{4}$/.test(raw)) {
        exp_month = parseInt(raw.slice(0, 2), 10);
        exp_year = 2000 + parseInt(raw.slice(2, 4), 10);
      } else if (/^\d{6}$/.test(raw)) {
        exp_month = parseInt(raw.slice(0, 2), 10);
        exp_year = parseInt(raw.slice(2, 6), 10);
      }

      return {
        id: r.id,
        type: "card",
        brand: r.card_type,
        last4,
        exp_month,
        exp_year,
        payer_ref: r.payer_ref,
        pmt_ref: r.token,
        is_default: idx === 0
      };
    });

    // E-wallet
    const [[wallet]] = await connection.query(
      `SELECT balance FROM e_wallet 
         WHERE user_id = ? 
         ORDER BY e_wallet_id DESC LIMIT 1`,
      [userId]
    );

    const ewallet = {
      type: "ewallet",
      balance: wallet?.balance ?? 0,
      currency: "EUR"
    };

    return res.json([...cardMethods, ewallet]);
  } catch (e) {
    console.error("❌ listUserPaymentMethods:", e);
    return res.status(500).json({ error: "No se pudieron obtener métodos" });
  } finally {
    connection?.release?.();
  }
}

export async function manualCharge(req, res) {
  const { user_id, payer_ref, type, pmt_ref, product_id, amount, currency } = req.body;

  if (!user_id || !amount || !currency) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  try {
    // Caso e-wallet
    if (type === "ewallet") {
      const conn = await req.db.getConnection();
      const [[wallet]] = await conn.query(
        `SELECT balance FROM e_wallet WHERE user_id = ? 
           ORDER BY e_wallet_id DESC LIMIT 1`,
        [user_id]
      );

      const balance = wallet?.balance ?? 0;
      if (balance < amount) {
        return res.status(400).json({ error: "Saldo insuficiente" });
      }

      const newBalance = balance - amount;
      await conn.execute(
        `INSERT INTO e_wallet 
          (e_wallet_tran_code, user_id, amount, balance, transaction_title, transaction_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [`MANUAL-${Date.now()}`, user_id, -amount, newBalance, "Cobro manual", "manual_charge"]
      );
      conn.release();

      return res.json({ ok: true, method: "ewallet", balance: newBalance });
    }

    // Caso tarjeta
    if (type === "card" && payer_ref && pmt_ref) {
      const r = await runReceiptIn({
        amountMinor: Math.round(amount * 100),
        currency,
        payerref: payer_ref,
        paymentmethod: pmt_ref
      });

      const conn = await req.db.getConnection();
      await conn.execute(
        `INSERT INTO charges (subscription_id, product_id, orderid, pasref, result, authcode, message, raw_response)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product_id,        // 👈 aquí ya guardas el producto
          r.orderId,
          r.pasref,
          r.result,
          r.authcode,
          r.message,
          (r.raw || "").slice(0, 20000),
        ]
      );
      conn.release();

      return res.json({ ok: r.result === "00", ...r });
    }

    return res.status(400).json({ error: "Tipo inválido o datos incompletos" });
  } catch (err) {
    console.error("❌ manualCharge:", err);
    return res.status(500).json({ error: "Error procesando cargo" });
  }
}

