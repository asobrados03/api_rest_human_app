import {logActivity} from "../utils/logger.js"
import fs from 'fs'
import path, { join } from 'path'
import { promisify } from 'util'
import bcrypt from 'bcrypt'
import { UPLOAD_PATH } from "../middlewares/uploadProfile_Pic.js"

const unlinkAsync = promisify(fs.unlink)

export async function getUser(req, res) {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: "Falta user_id" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const [rows] = await connection.execute(
      `SELECT 
         u.user_id       AS id,
         u.user_name     AS fullName,
         u.email,
         u.phone,
         u.sex,
         u.date_of_birth AS dateOfBirth,
         u.postal_code   AS postcode,
         u.address       AS postAddress,
         u.dni,
         u.profile_pic   AS profilePictureName,
         u.type,
         u.language,
         u.customer_training_factor,
         u.customer_company,
         u.aprende_entrenar,
         u.tour,
         u.is_account_verified,
         u.is_authorized,
         u.is_cash_setup,
         u.stripe_customer_id,
         u.device_type,
         u.device_token,
         u.created_at,
         u.updated_at
       FROM users u
       WHERE u.user_id = ? AND u.deleted_at IS NULL
       LIMIT 1`,
      [user_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = rows[0];

    // añadir URL completa a la foto de perfil si existe
    if (user.profilePictureName) {
      user.profilePictureUrl = `${process.env.API_BASE}/api/profile_pic/${user.profilePictureName}`;
    }

    return res.status(200).json(user);
  } catch (err) {
    console.error("❌ getUser error:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    if (connection) connection.release();
  }
}


export async function getUserSubscriptions(req, res) {
  let connection;
  try {
    connection = await req.db.getConnection();

    // Obtener suscripciones
    const [rows] = await connection.execute(
      `SELECT 
         s.id, 
         s.user_id, 
         u.user_name, 
         u.phone, 
         s.payerref, 
         s.paymentmethod,
         s.amount_minor, 
         s.currency, 
         s.interval_months, 
         s.next_charge_at, 
         s.status, 
         s.last_result, 
         s.updated_at, 
         s.order_prefix
       FROM subscriptions s
       JOIN users u ON u.user_id = s.user_id
       ORDER BY s.id DESC`
    );

    // Normalizar last_result para ewallet
    const subs = rows.map(sub => {
      if (sub.paymentmethod === "ewallet") {
        return {
          ...sub,
          last_result: JSON.stringify({
            result: "success",
            message: "Pago realizado con e-wallet",
            orderId: sub.order_prefix,
            pasref: "N/A",
            authcode: "N/A"
          })
        };
      }
      return sub;
    });

    return res.status(200).json({ subscriptions: subs });
  } catch (err) {
    console.error("Error en getUserSubscriptions →", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    if (connection) connection.release();
  }
}

export async function getSubscriptionsHistory(req, res) {
  let connection;
  try {
    connection = await req.db.getConnection();

    // Obtener histórico
    const [rows] = await connection.execute(
      `SELECT 
        h.id,
        u.user_name,
        u.phone,
        h.product_id,
        h.amount_minor,
        h.currency,
        h.month_year,
        h.paid_date,
        h.delay_days,
        h.method,
        h.status,
        h.pasref,
        h.orderid,
        h.message
      FROM subscription_history h
      JOIN users u ON u.user_id = h.user_id
      ORDER BY h.month_year DESC, h.id DESC`
    );

    // Normalizar datos si es ewallet
    const history = rows.map(h => {
      if (h.method === "ewallet") {
        return {
          ...h,
          message: h.message || "Pago realizado con e-wallet",
          pasref: h.pasref || "N/A",
          orderid: h.orderid || `EW-${h.id.toString().padStart(6, "0")}`,
        };
      }
      return h;
    });

    return res.status(200).json({ history });
  } catch (err) {
    console.error("Error en getSubscriptionsHistory →", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    if (connection) connection.release();
  }
}

export async function updateUser(req, res) {
    let connection
    try {
        // — 1) Parsear JSON de "user" —
        const raw = req.body.user
        if (!raw) {
            return res.status(400).json({ error: "Se requiere el campo 'user' en el form-data" })
        }
        const data = JSON.parse(raw)

        // — 2) Validar token y datos obligatorios —
        const { id: userIdToken, email: emailToken } = req.user_payload
        const userId = data.id
        const email  = data.email
        if (!userId) {
            return res.status(400).json({ error: "Se requiere el campo 'id' del usuario" })
        }
        if (userId !== userIdToken || email !== emailToken) {
            return res.status(401).json({ error: 'No estás autorizado' })
        }
        if (data.sex === '' || data.sex === 'NULL') data.sex = null;

        // — 3) Si hay fichero nuevo, vamos a necesitar el antiguo —
        let oldImageName
        if (req.file) {
            connection = await req.db.getConnection()
            const [rows] = await connection.execute(
                'SELECT profile_pic FROM users WHERE user_id = ?',
                [userId]
            )
            if (rows.length) {
                oldImageName = rows[0].profile_pic
            }
        }

        if (req.file) {
            data.profilePictureName = req.file.filename
        }

        const allowedFields = {
            fullName: 'user_name',
            email: 'email',
            phone: 'phone',
            sex: 'sex',
            dateOfBirth: 'date_of_birth',
            postcode: 'postal_code',
            postAddress: 'address',
            dni: 'dni',
            profilePictureName: 'profile_pic'
        }

        const setClauses = []
        const values = []

        for (const [jsonKey, column] of Object.entries(allowedFields)) {
            if (data.hasOwnProperty(jsonKey)) {
                let value = data[jsonKey]

                // ✅ Permitir que el sexo sea NULL
                if (value === 'NULL' || column === 'sex' && (value === '' || value === null)) {
                    setClauses.push(`\`${column}\` = NULL`)
                    continue
                }

                setClauses.push(`\`${column}\` = ?`)
                values.push(value)
            }
        }

        if (!setClauses.length) {
            connection?.release()
            return res.status(400).json({ error: 'No se recibieron campos válidos para actualizar' })
        }

        setClauses.push('`updated_at` = NOW()')
        values.push(userId)

        const sqlUpdate = `
          UPDATE users
          SET ${setClauses.join(', ')}
          WHERE user_id = ?`

        if (!connection) {
            connection = await req.db.getConnection()
        }

        await connection.beginTransaction()
        await connection.execute(sqlUpdate, values)

        const [updatedRows] = await connection.execute(
            'SELECT * FROM users WHERE user_id = ?',
            [userId]
        )
        await connection.commit()
        connection.release()

        if (!updatedRows.length) {
            return res.status(404).json({ error: 'Usuario no encontrado después de la actualización' })
        }

        const u = updatedRows[0]

        // — Borrar fichero antiguo (si se subió uno nuevo) —
        if (req.file && oldImageName) {
            const oldPath = path.join(UPLOAD_PATH, oldImageName)
            await unlinkAsync(oldPath).catch(err =>
                console.warn(`No se pudo eliminar imagen antigua ${oldImageName}:`, err)
            )
        }

        try {
            await logActivity(req, {
                subject: `El usuario ${email} (ID: ${userId}) actualizó su perfil`,
                userId: userId
            })
        } catch (logErr) {
            console.error("⚠️ Logging error (updateUser):", logErr)
        }

        return res.status(200).json({
            id: u.user_id,
            fullName: u.user_name || '',
            email: u.email || '',
            phone: u.phone || '',
            sex: u.sex || null, // 👈 devuelve null si no hay valor
            dateOfBirth: u.date_of_birth
                ? u.date_of_birth.toISOString().split('T')[0]
                : null,
            postcode: u.postal_code != null
                ? parseInt(u.postal_code, 10)
                : null,
            postAddress: u.address || '',
            dni: u.dni,
            profilePictureName: u.profile_pic || null
        })
    } catch (err) {
        console.error(`Error al actualizar usuario:`, err)
        if (connection) {
            await connection.rollback()
            connection.release()
        }
        return res.status(500).json({ error: err.message })
    } finally {
        if (connection) connection.release()
    }
}


export async function deleteUser(req, res) {
  const emailToken = req.user_payload.email;
  const { email: rawEmail, password: rawPassword } = req.body || {};

  if (!rawEmail || !rawPassword) {
    return res.status(400).json({ error: "Se requieren email y contraseña" });
  }

  if (rawEmail !== emailToken) {
    return res.status(401).json({ error: "No estás autorizado" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const email = rawEmail.trim().toLowerCase();

    // 1️⃣ Buscar usuario
    const [rows] = await connection.execute(
      "SELECT user_id, password FROM users WHERE email = ?",
      [email]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `Usuario '${email}' no encontrado` });
    }

    const user = rows[0];

    // 2️⃣ Validar contraseña con bcrypt (igual que en loginUser)
    const match = await bcrypt.compare(rawPassword, user.password);
    if (!match) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    await connection.beginTransaction();

    // 3️⃣ Eliminar usuario
    const [result] = await connection.execute(
      "DELETE FROM users WHERE email = ?",
      [email]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: `No se encontró ningún usuario con email '${email}'` });
    }

    // 4️⃣ Log de actividad
    try {
      await logActivity(req, {
        subject: `El usuario con email ${email} fue eliminado`,
        userId: user.user_id,
      });
    } catch (logErr) {
      console.error("⚠️ Logging error (deleteUser):", logErr);
    }

    await connection.commit();

    return res
      .status(200)
      .json({ message: `Usuario '${email}' eliminado correctamente` });
  } catch (err) {
    console.error(`Error al eliminar usuario ${rawEmail}:`, err);
    if (connection) await connection.rollback();
    return res.status(500).json({ error: "Error interno al eliminar el usuario" });
  } finally {
    if (connection) connection.release();
  }
}

export async function getCoaches(req, res) {
    // Lista de nombres a excluir
    const excludedNames = ['COMODIN', 'ALTER G', 'Servicio de presoterapia']

    // Generamos placeholders para la query parametrizada
    const placeholders = excludedNames.map(_ => '?').join(',')

    const sql = `
        SELECT u.user_id       AS id,
               u.profile_pic   AS profile_photo,
               u.user_name     AS name,
               s.name  AS service,
               se.centro AS centro
        FROM users u
        JOIN services se ON u.service_id = se.service_id
        JOIN service_primary sp ON se.service_id = sp.service_id
        JOIN primary_service s ON sp.primary_service_id = s.primary_service_id
        WHERE u.type = 'coach'
          AND u.deleted_at IS NULL
          -- Excluimos los nombres no-persona
          AND UPPER(u.user_name) NOT IN (${placeholders})
        ORDER BY u.created_at DESC`

    let connection

    try {
        connection = await req.db.getConnection()
        await connection.beginTransaction()

        // Pasamos el array de excludedNames como parámetros
        const [rows] = await connection.query(sql, excludedNames)

        await connection.commit()

        return res.status(200).json(rows)
    } catch (err) {
        console.error('Error en getCoaches →', err)
        return res.status(500).json({ error: err.message })
    } finally {
        if (connection) connection.release()
    }
}

export async function assignPreferredCoach(req, res) {
    const { service_name, customer_id, coach_id } = req.body

    if (!service_name || !customer_id || !coach_id) {
        return res.status(400).json({
            message: 'Los campos service_name, customer_id y coach_id son obligatorios.'
        })
    }

    let connection

    try {
        connection = await req.db.getConnection()
        await connection.beginTransaction()

        // 1) Buscar el primary_service_id a partir de service_name
        console.log("Buscando primary_service_id para:", service_name)

        const [services] = await connection.query(
            `SELECT primary_service_id
             FROM primary_service
             WHERE name = ?
               AND deleted_at IS NULL
                 LIMIT 1`,
            [service_name]
        )

        if (services.length === 0) {
            await connection.rollback()
            return res.status(400).json({
                message: `No existe ningún servicio llamado "${service_name}".`
            })
        }

        const service_id = services[0].primary_service_id

        // 2) Verificar si ya hay un entrenador favorito para este cliente
        const [existing] = await connection.query(
            `SELECT preferred_coach_id
            FROM preferred_coach
            WHERE customer_id = ? AND service_id = ?`,
            [customer_id, service_id]
        );

        if (existing.length > 0) {
            // 3a) UPDATE
            await connection.query(
                `UPDATE preferred_coach
                    SET coach_id = ?,
                        updated_at = CURRENT_TIMESTAMP()
                 WHERE preferred_coach_id = ?`,
                [coach_id, existing[0].preferred_coach_id]
            )

            await connection.commit()

            // Log
            try {
                await logActivity(req, {
                    subject: `El usuario con id ${customer_id} marcó como favorito al profesional con id ${coach_id}`,
                    userId: req.user_payload.id || 0
                })
            } catch (logErr) {
                console.error("⚠️ Logging error (assignPreferredCoach):", logErr)
            }

            return res.status(200).json({
                message: 'Entrenador favorito actualizado correctamente.'
            })

        } else {
            // 3b) INSERT
            await connection.query(
                `INSERT INTO preferred_coach (service_id, customer_id, coach_id)
                 VALUES (?, ?, ?)`,
                [service_id, customer_id, coach_id]
            )

            await connection.commit()

            // Log
            try {
                await logActivity(req, {
                    subject: `El usuario con id ${customer_id} marcó como favorito al profesional con id ${coach_id}`,
                    userId: req.user_payload.id || 0
                });
            } catch (logErr) {
                console.error("⚠️ Logging error (assignPreferredCoach):", logErr)
            }

            return res.status(201).json({
                message: 'Entrenador favorito asignado correctamente.'
            })
        }

    } catch (err) {
        if (connection) await connection.rollback()
        console.error('Error en assignPreferredCoach →', err)

        return res.status(500).json({
            message: 'Error interno del servidor: ' + err.message
        })
    } finally {
        if (connection) connection.release()
    }
}

export async function getPreferredCoach(req, res) {
    console.log("Query recibida:", req.query)
    const { customer_id } = req.query

    if (!customer_id) {
        return res.status(400).json({
            error: 'El campo customer_id es obligatorio.'
        })
    }

    let connection
    try {
        connection = await req.db.getConnection()

        // Consultar solo el coach_id favorito para ese cliente
        const [rows] = await connection.query(
            `SELECT coach_id
               FROM preferred_coach
              WHERE customer_id = ?
              LIMIT 1`,
            [customer_id]
        )

        if (rows.length === 0) {
            return res.status(404).json({
                error: 'No tienes un profesional favorito asignado.'
            })
        }

        // Log
        try {
            await logActivity(req, {
                subject: `El usuario con id ${customer_id} obtuvo su coach preferido con id ${coach?.id ?? 'ninguno'}`,
                userId: req.user_payload.id || 0
            });
        } catch (logErr) {
            console.error("⚠️ Logging error (getPreferredCoach):", logErr);
        }

        // Devolver sólo el id del coach favorito
        return res.status(200).json({
            preferred_coach_id: rows[0].coach_id
        })

    } catch (err) {
        console.error('Error en getPreferredCoach →', err)
        return res.status(500).json({
            error: 'Error interno del servidor: ' + err.message
        })
    } finally {
        if (connection) connection.release()
    }
}

export async function getPreferredCoachWithService(req, res) {
  const { customer_id, service_name } = req.query;

  if (!customer_id || !service_name) {
    return res.status(400).json({
      error: 'customer_id y service_name son obligatorios.'
    });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // Convertir service_name → service_id
    const [services] = await connection.query(
      `SELECT primary_service_id
       FROM primary_service
       WHERE name = ? AND deleted_at IS NULL
       LIMIT 1`,
      [service_name]
    );

    if (services.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    const service_id = services[0].primary_service_id;

    // Buscar favorito de ese servicio
    const [rows] = await connection.query(
      `SELECT coach_id
         FROM preferred_coach
        WHERE customer_id = ? AND service_id = ?
        LIMIT 1`,
      [customer_id, service_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No tienes un favorito en este servicio.' });
    }

    return res.status(200).json({
      preferred_coach_id: rows[0].coach_id
    });

  } catch (err) {
    console.error('Error en getPreferredCoach →', err);
    return res.status(500).json({
      error: 'Error interno del servidor: ' + err.message
    });
  } finally {
    if (connection) connection.release();
  }
}

/**
 * DELETE /api/mobile/user/photo
 * Borra la foto de perfil del usuario autenticado.
 * Requiere middleware de auth que ponga req.user_payload = {id, email}
 */
export async function deleteProfilePic(req, res) {
    let connection

    try {
        const { id: userIdToken, email: emailToken } = req.user_payload;
        if (!userIdToken) {
            console.log('!userIdToken')
            return res.status(401).json({ error: 'No estás autenticado' })
        }

        const email = req.query.email
        const profilePicName = req.query.profilePictureName

        if (email !== emailToken) {
            console.log('No estás autorizado')
            console.log('❌ email mismatch:', email, emailToken)
            return res.status(401).json({ error: 'No estás autorizado' })
        }

        connection = await req.db.getConnection()
        await connection.beginTransaction()

        // 1) Obtener el nombre actual de la foto
        const [rows] = await connection.execute(
            'SELECT profile_pic FROM users WHERE user_id = ?',
            [userIdToken]
        )
        if (!rows.length || !rows[0].profile_pic) {
            await connection.commit()
            return res.status(404).json({ error: 'No existe foto de perfil para este usuario' })
        }
        const oldImageName = rows[0].profile_pic

        if (oldImageName !== profilePicName) {
            return res.status(404).json({error: 'El nombre de la foto de perfil no coincide con la base de datos'})
        }

        // 2) Borrar columna profile_pic en la BD
        await connection.execute(
            'UPDATE users SET profile_pic = NULL, updated_at = NOW() WHERE user_id = ?',
            [userIdToken]
        )

        await connection.commit()
        connection.release()

        // 3) Borrar el fichero del disco
        const filePath = join(UPLOAD_PATH, oldImageName)
        await unlinkAsync(filePath).catch(err => {
            // si fallo, lo logeamos pero no abortamos
            console.warn(`No se pudo borrar la imagen antigua ${oldImageName}:`, err)
        });

        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `La foto de perfil del usuario con email ${email} fue eliminada`,
                userId: req.user_payload.id || 0
            })
        } catch (logErr) {
            console.error("⚠️ Logging error (deleteProfilePic):", logErr)
        }

        return res.status(200).json({ message: 'Foto de perfil eliminada correctamente' })

    } catch (err) {
        console.error('Error al eliminar foto de perfil:', err)
        if (connection) {
            await connection.rollback()
            connection.release()
        }
        return res.status(500).json({ error: 'Error interno al eliminar la foto' })
    }
}

export async function getUserStats(req, res) {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'Falta user_id' });

  // Ventana del mes pasado
  const monthWindow = `
    b.start_date BETWEEN
      DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
      AND LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
  `;

  const sqlCountLastMonthByService = `
    SELECT b.service_id,
           s.name AS service_name,
           COUNT(*) AS total
    FROM bookings b
    JOIN primary_service s ON s.primary_service_id = b.service_id
    WHERE b.customer_id = ?
      AND ${monthWindow}
      AND b.deleted_at IS NULL
      AND b.status = 'active'
    GROUP BY b.service_id, s.name
  `;

  const sqlTopCoachByService = `
    SELECT x.service_id,
           x.service_name,
           x.coach_name,
           x.cnt
    FROM (
      SELECT b.service_id,
             s.name AS service_name,
             u.user_name AS coach_name,
             COUNT(*) AS cnt,
             ROW_NUMBER() OVER (PARTITION BY b.service_id ORDER BY COUNT(*) DESC) AS rn
      FROM bookings b
      JOIN users u           ON u.user_id = b.coach_id
      JOIN primary_service s ON s.primary_service_id = b.service_id
      WHERE b.customer_id = ?
        AND u.deleted_at IS NULL
      GROUP BY b.service_id, s.name, u.user_name
    ) x
    WHERE x.rn = 1
  `;

  const sqlPendingByService = `
    SELECT 
        b.service_id,
        s.name AS service_name,
        COUNT(*) AS total
        FROM bookings b
        JOIN primary_service s 
        ON s.primary_service_id = b.service_id
        WHERE 
            b.customer_id = ?
        AND DATE(b.start_date) >= CURDATE()
        AND b.deleted_at IS NULL
        AND b.status <> 'canceled'
    GROUP BY b.service_id, s.name
  `;

  let connection;
  try {
    connection = await req.db.getConnection();

    const [rowsLastMonth] = await connection.query(sqlCountLastMonthByService, [userId]);
    const [rowsTopCoach]  = await connection.query(sqlTopCoachByService, [userId]);
    const [rowsPending]   = await connection.query(sqlPendingByService, [userId]);

    const byService = new Map();
    const upsert = (sid, name) => {
      if (!byService.has(sid)) {
        byService.set(sid, {
          service_id: sid,
          service_name: name || '',
          entrenamientosMesPasado: 0,
          entrenadorMasUsado: null,
          reservasPendientes: 0
        });
      }
      return byService.get(sid);
    };

    for (const r of rowsLastMonth) {
      const it = upsert(r.service_id, r.service_name);
      it.entrenamientosMesPasado = r.total ?? 0;
    }
    for (const r of rowsTopCoach) {
      const it = upsert(r.service_id, r.service_name);
      it.entrenadorMasUsado = r.coach_name || null;
    }
    for (const r of rowsPending) {
      const it = upsert(r.service_id, r.service_name);
      it.reservasPendientes = r.total ?? 0;
    }

    res.status(200).json({ byService: Array.from(byService.values()) });
  } catch (err) {
    console.error('Error en getUserStats →', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
}

// util CSV
function csvToArr(csv) {
  if (csv == null || csv === "") return [];
  return String(csv).split(",").map(s => s.trim()).filter(Boolean);
}
function arrToCsv(arr) { return arr.filter(Boolean).join(","); }

// POST /api/mobile/user/:userId/coupon  { coupon_code }
export async function addCouponToUser(req, res) {
  const userId = Number(req.params.userId);
  const { coupon_code } = req.body;
  const { id: userIdToken } = req.user_payload || {};
  if (!coupon_code) return res.status(400).json({ error: "Se requiere coupon_code" });
  if (!userIdToken || userIdToken !== userId) return res.status(401).json({ error: "No estás autenticado." });

  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();

    // cupón vigente
    const [[coupon]] = await conn.query(
      `SELECT coupon_id, customer_ids
         FROM coupons
        WHERE coupon_code = ?
          AND deleted_at  IS NULL
          AND start_date <= CURDATE()
          AND expiry_date>= CURDATE()
        LIMIT 1`,
      [coupon_code]
    );
    if (!coupon) {
      await conn.rollback();
      return res.status(400).json({ error: "Cupón inválido o expirado" });
    }

    // permiso (customer_ids NULL => todos)
    const whitelist = coupon.customer_ids == null ? null : csvToArr(coupon.customer_ids);
    const allowed = whitelist === null ? true : whitelist.includes(String(userId));
    if (!allowed) {
      await conn.rollback();
      return res.status(403).json({ error: "No tienes permiso para usar este cupón" });
    }

    // añadir a users.coupons_ids
    const [[u]] = await conn.query(`SELECT coupons_ids FROM users WHERE user_id = ? LIMIT 1`, [userId]);
    if (!u) { await conn.rollback(); return res.status(404).json({ error: "Usuario no encontrado" }); }
    const current = csvToArr(u.coupons_ids);
    if (!current.includes(String(coupon.coupon_id))) {
      current.push(String(coupon.coupon_id));
      await conn.query(
        `UPDATE users SET coupons_ids = ?, updated_at = NOW() WHERE user_id = ?`,
        [arrToCsv(current), userId]
      );
    }

    await conn.commit();
    return res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    console.error("addCouponToUser error:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    conn.release();
  }
}

// POST /api/mobile/user/:userId/coupon/remove  { coupon_code }
export async function removeCouponToUser(req, res) {
  const userId = Number(req.params.userId);
  const { coupon_code } = req.body;
  const { id: userIdToken } = req.user_payload || {};
  if (!coupon_code) return res.status(400).json({ error: "Se requiere coupon_code" });
  if (!userIdToken || userIdToken !== userId) return res.status(401).json({ error: "No estás autenticado." });

  const conn = await req.db.getConnection();
  try {
    await conn.beginTransaction();

    // localizar cupón por code (no exigimos fechas para “limpiar”)
    const [[coupon]] = await conn.query(
      `SELECT coupon_id
         FROM coupons
        WHERE coupon_code = ?
          AND deleted_at IS NULL
        LIMIT 1`,
      [coupon_code]
    );
    if (!coupon) { await conn.rollback(); return res.status(404).json({ error: "Cupón no encontrado" }); }

    // quitar de users.coupons_ids
    const [[u]] = await conn.query(`SELECT coupons_ids FROM users WHERE user_id = ? LIMIT 1`, [userId]);
    if (!u) { await conn.rollback(); return res.status(404).json({ error: "Usuario no encontrado" }); }

    const cur = csvToArr(u.coupons_ids);
    const next = cur.filter(id => id !== String(coupon.coupon_id));
    if (next.length === cur.length) {
      await conn.rollback();
      return res.status(400).json({ error: "El usuario no tiene este cupón asignado" });
    }
    await conn.query(
      `UPDATE users SET coupons_ids = ?, updated_at = NOW() WHERE user_id = ?`,
      [arrToCsv(next), userId]
    );

    await conn.commit();
    return res.sendStatus(204);
  } catch (err) {
    await conn.rollback();
    console.error("removeCouponToUser error:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    conn.release();
  }
}

// GET /api/mobile/user/:userId/coupon
export async function getUserCoupon(req, res) {
  const userId = Number(req.params.userId);
  const { id: userIdToken } = req.user_payload || {};
  if (!userIdToken || userIdToken !== userId) return res.status(401).json({ error: "No estás autenticado" });

  const conn = await req.db.getConnection();
  try {
    // leer ids del usuario
    const [[u]] = await conn.query(`SELECT coupons_ids FROM users WHERE user_id = ? LIMIT 1`, [userId]);
    const idsArr = csvToArr(u?.coupons_ids);
    if (idsArr.length === 0) return res.sendStatus(204);

    const placeholders = idsArr.map(() => "?").join(",");
    const params = [...idsArr, userId];

    // traer cupones vigentes + permiso (NULL => todos, CSV => whitelist)
    const [rows] = await conn.query(
      `
      SELECT
        coupon_id      AS id,
        coupon_code    AS code,
        discount,
        is_percentage  AS isPercentage,
        DATE_FORMAT(start_date,  '%Y-%m-%d') AS startDate,
        DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate,
        product_ids,
        customer_ids
      FROM coupons
      WHERE coupon_id IN (${placeholders})
        AND deleted_at IS NULL
        AND start_date <= CURDATE()
        AND expiry_date >= CURDATE()
        AND (
          customer_ids IS NULL
          OR FIND_IN_SET(?, customer_ids)
        )
      `,
      params
    );

    if (rows.length === 0) return res.sendStatus(204);

    const result = rows.map(r => ({
      id: r.id,
      code: r.code,
      discount: r.discount,
      isPercentage: Boolean(r.isPercentage),
      startDate: r.startDate,
      expiryDate: r.expiryDate,
      productIds: typeof r.product_ids === "string"
        ? r.product_ids.split(",").map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n))
        : []
    }));

    return res.status(200).json(result);
  } catch (err) {
    console.error("getUserCoupon error:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    conn.release();
  }
}

export async function uploadUserDocument(req, res) {
    let connection;
    try {
        // El middleware de multer ya se ejecutó
        if (!req.file) {
            return res.status(400).json({
                error: 'No se ha recibido ningún archivo.'
            })
        }

        const userId = req.user_payload.id
        const filename = req.file.filename
        const relativePath = path.join('uploads', 'users', 'documents', String(userId), filename)

        // Guardar metadatos en BD para permitir borrado lógico
        connection = await req.db.getConnection();
        await connection.beginTransaction();

        await connection.execute(`
            INSERT INTO dropbox (customer_id, document_original_name, document, created_at)
            VALUES (?, ?, ?, NOW())
        `, [userId, req.file.originalname, filename]);

        await connection.commit();

        // ✅ Log activity (uploadUserDocument)
        try {
            await logActivity(req, {
                subject: `El usuario con id ${userId} subió el documento ${filename} en el directorio /${relativePath}`,
                userId: userId
            })
        } catch (logErr) {
            console.error("⚠️ Logging error (uploadUserDocument):", logErr)
        }

        return res.status(200).json({
            message: 'Documento subido con éxito.'
        })

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('❌ Error en uploadUserDocument:', error)

        // Manejar errores específicos de multer si llegaron hasta aquí
        if (error instanceof multer.MulterError) {
            switch (error.code) {
                case 'LIMIT_FILE_SIZE':
                    return res.status(400).json({
                        error: 'El archivo es demasiado grande. Máximo 10MB.'
                    })
                case 'LIMIT_FILE_COUNT':
                    return res.status(400).json({
                        error: 'Demasiados archivos. Solo se permite uno.'
                    })
                default:
                    return res.status(400).json({
                        error: 'Error en la subida del archivo.'
                    })
            }
        }

        return res.status(500).json({
            error: 'Error interno del servidor al procesar el archivo.'
        })
    } finally {
        if (connection) connection.release();
    }
}

export async function uploadCustomerDocument(req, res) {
    let connection;
    try {
      console.log('[upload] params:', req.params);
      console.log('[upload] headers:', req.headers['content-type']);
      console.log('[upload] file?', !!req.file, req.file?.fieldname, req.file?.originalname, req.file?.size);
      console.log('[upload] token user:', req.user_payload?.id);
        // Verificar archivo
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha recibido ningún archivo.' });
        }

        // 🆕 Tomamos el ID desde los parámetros (por ejemplo /api/mobile/user/:userId/upload-customer-documen)
        const user_id = parseInt(req.params.userId, 10);
        if (isNaN(user_id)) {
            return res.status(400).json({ error: 'Parámetro user_id inválido.' });
        }
        const userId = req.user_payload.id;
        if (!userId) {
            return res.status(401).json({ error: 'No estás autenticado.' });
        }

        const filename = req.file.filename;
        const relativePath = path.join('uploads', 'users', 'documents', String(user_id), filename);

        connection = await req.db.getConnection();
        await connection.beginTransaction();

        await connection.execute(`
            INSERT INTO dropbox (customer_id, document_original_name, document, created_at)
            VALUES (?, ?, ?, NOW())
        `, [user_id, req.file.originalname, filename]);

        await connection.commit();

        // 🪵 Log actividad
        try {
            await logActivity(req, {
                subject: `El usuario con id ${userId} subió el documento ${filename} en /${relativePath}`,
                userId: userId
            });
        } catch (logErr) {
            console.error("⚠️ Logging error (uploadUserDocument):", logErr);
        }

        return res.status(200).json({ message: 'Documento subido con éxito.' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error en uploadUserDocument:', error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar el archivo.' });
    } finally {
        if (connection) connection.release();
    }
}



export async function deleteUserDocument(req, res) {
  const userId = req.user_payload.id;
  const filename = req.params.filename;

  if (!userId) {
    return res.status(401).json({ error: 'No estás autenticado.' });
  }
  if (!filename) {
    return res.status(400).json({ error: 'Debe especificar el nombre del documento.' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();
    await connection.beginTransaction();

    // Verificar que existe el documento en la BD y no está ya eliminado
    const [rows] = await connection.execute(
      'SELECT document FROM dropbox WHERE customer_id = ? AND document = ? AND deleted_at IS NULL LIMIT 1',
      [userId, filename]
    );
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Documento no encontrado o ya eliminado.' });
    }

    // Marcar documento como eliminado (borrado lógico)
    await connection.execute(
      'UPDATE dropbox SET deleted_at = NOW() WHERE customer_id = ? AND document = ? AND deleted_at IS NULL',
      [userId, filename]
    );

    await connection.commit();

    // Registrar log
    try {
      await logActivity(req, {
        subject: `El usuario con id ${userId} marcó como eliminado el documento ${filename}`,
        userId: userId,
      });
    } catch (logErr) {
      console.error("⚠️ Logging error (deleteUserDocument):", logErr);
    }

    return res.status(200).json({ message: 'Documento marcado como eliminado' });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    console.error('❌ Error al eliminar documento:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (connection) connection.release();
  }
}

export async function getUserDocuments(req, res) {
  const userId = req.user_payload.id;

  if (!userId) {
    return res.status(401).json({ error: 'No estás autenticado.' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // Obtener documentos del usuario que no están eliminados
    const [rows] = await connection.execute(`
      SELECT
        document_original_name AS document_name,
        created_at,
        document
      FROM dropbox
      WHERE customer_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `, [userId]);

    return res.status(200).json({ documents: rows });
  } catch (err) {
    console.error('❌ Error al obtener documentos del usuario:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (connection) connection.release();
  }
}

export async function getEwalletBalance(req, res) {
    const userId = req.query.user_id;

    if (!userId) {
        return res.status(400).json({ error: 'Falta user_id' });
    }

    let connection;
    try {
        connection = await req.db.getConnection();

        const [[result]] = await connection.execute(`
            SELECT balance
            FROM e_wallet
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId]);

        const balance = result?.balance ?? 0;

        res.json({ balance });
    } catch (err) {
        console.error('[ERROR] GET /mobile/e-wallet-balance →', err);
        res.status(500).json({ error: 'Error al obtener saldo', details: err.message });
    } finally {
        if (connection) connection.release();
    }
}

export async function checkSavedPaymentMethod(req, res) {
  const userId = parseInt(req.query.user_id, 10);
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  try {
    const [rows] = await req.db.execute(
      'SELECT token FROM addon_tokens_store WHERE user_id = ? LIMIT 1',
      [userId]
    );

    const hasCard = rows.length > 0;
    res.json({ hasCard });
  } catch (err) {
    console.error('❌ Error comprobando tarjeta guardada:', err);
    res.status(500).json({ error: 'Error interno comprobando tarjeta' });
  }
}

// controllers/user.mobile.js
export async function getUserTourFlag(req, res) {
  let conn;
  try {
    const { id: userIdToken } = req.user_payload || {};
    if (!userIdToken) return res.status(401).json({ error: 'No estás autenticado' });

    conn = await req.db.getConnection();
    const [[row]] = await conn.execute(
      'SELECT COALESCE(tour, 0) AS tour FROM users WHERE user_id = ?',
      [userIdToken]
    );

    return res.status(200).json({ tour: Boolean(row?.tour) });
  } catch (err) {
    console.error('getUserTourFlag error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn?.release?.();
  }
}

export async function setUserTourFlag(req, res) {
  let conn;
  try {
    const { id: userIdToken } = req.user_payload || {};
    if (!userIdToken) return res.status(401).json({ error: 'No estás autenticado' });

    const { tour } = req.body || {};
    if (typeof tour !== 'boolean') {
      return res.status(400).json({ error: "Se requiere body { tour: boolean }" });
    }

    conn = await req.db.getConnection();
    await conn.beginTransaction();

    await conn.execute(
      'UPDATE users SET tour = ? , updated_at = NOW() WHERE user_id = ?',
      [tour ? 1 : 0, userIdToken]
    );

    await conn.commit();
    return res.status(200).json({ tour });
  } catch (err) {
    try { await conn?.rollback?.(); } catch {}
    console.error('setUserTourFlag error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn?.release?.();
  }
}

export async function getEwalletTransactions(req, res) {
  const userId = req.query.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'Falta user_id' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const [rows] = await connection.execute(`
      SELECT 
        l.amount,
        l.balance,
        l.transaction_title AS description,
        l.transaction_type AS type,
        l.created_at,
        p.product_name
      FROM e_wallet l
      LEFT JOIN products p ON l.product_id = p.product_id
      WHERE l.user_id = ?
      ORDER BY l.created_at DESC
      LIMIT 10
    `, [userId]);

    const formatted = rows.map(tx => ({
      amount: tx.amount,
      balance: tx.balance,
      description: tx.product_name || tx.description || "",
      type: tx.type,
      date: tx.created_at
    }));

    return res.status(200).json({ transactions: formatted });
  } catch (err) {
    console.error("❌ Error al obtener transacciones:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
}

export async function searchUsers(req, res) {
  const { search } = req.query;
  if (!search) {
    return res.status(400).json({ error: "Falta parámetro search" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const [rows] = await connection.query(
      `SELECT user_id AS id, user_name AS name, email, CONCAT('user_', user_id) AS payer_ref
         FROM users
        WHERE user_name LIKE ? OR email LIKE ?
        ORDER BY user_name ASC
        LIMIT 20`,
      [`%${search}%`, `%${search}%`]
    );

    return res.json(rows);
  } catch (err) {
    console.error("❌ searchUsers:", err);
    return res.status(500).json({ error: "Error buscando usuarios" });
  } finally {
    connection?.release?.();
  }
}
