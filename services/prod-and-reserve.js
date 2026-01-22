import {logActivity} from "../utils/logger.js";

const DAY_ALIAS_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_TOKEN_TO_ALIAS = {
  sun: 'sun',
  sunday: 'sun',
  dom: 'sun',
  domingo: 'sun',
  '0': 'sun',
  '00': 'sun',
  '7': 'sun',
  '07': 'sun',
  mon: 'mon',
  monday: 'mon',
  lun: 'mon',
  lunes: 'mon',
  '1': 'mon',
  '01': 'mon',
  tue: 'tue',
  tuesday: 'tue',
  mar: 'tue',
  martes: 'tue',
  '2': 'tue',
  '02': 'tue',
  wed: 'wed',
  wednesday: 'wed',
  mie: 'wed',
  mier: 'wed',
  miercoles: 'wed',
  miércoles: 'wed',
  '3': 'wed',
  '03': 'wed',
  thu: 'thu',
  thursday: 'thu',
  jue: 'thu',
  jueves: 'thu',
  '4': 'thu',
  '04': 'thu',
  fri: 'fri',
  friday: 'fri',
  vie: 'fri',
  viernes: 'fri',
  '5': 'fri',
  '05': 'fri',
  sat: 'sat',
  saturday: 'sat',
  sab: 'sat',
  sabado: 'sat',
  sábado: 'sat',
  '6': 'sat',
  '06': 'sat',
};

function stripDiacritics(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeDayToken(token) {
  return stripDiacritics(String(token ?? '')).trim().toLowerCase();
}

function tokenToAlias(token) {
  const normalized = normalizeDayToken(token);
  return DAY_TOKEN_TO_ALIAS[normalized] || null;
}

function parseDayAliases(value) {
  const raw = stripDiacritics(String(value ?? '')).trim();
  if (!raw) return new Set();
  const parts = raw.split(/[^0-9a-zA-Z]+/).filter(Boolean);
  if (!parts.length) return new Set();

  let hasAlias = false;
  const out = new Set();

  for (const part of parts) {
    const normalized = normalizeDayToken(part);
    if (['all', 'todos', 'diario', 'daily', 'any', 'cualquiera'].includes(normalized)) {
      return new Set();
    }
    const alias = DAY_TOKEN_TO_ALIAS[normalized];
    if (alias) {
      hasAlias = true;
      out.add(alias);
    }
  }

  return hasAlias ? out : new Set();
}

function matchesDayAlias(aliasSet, alias) {
  return !aliasSet || aliasSet.size === 0 || aliasSet.has(alias);
}

function getDayAliasForDate(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return 'mon';

  const options = { weekday: 'long', timeZone: 'Europe/Madrid' };
  const candidates = [
    date.toLocaleDateString('es-ES', options),
    date.toLocaleDateString('es', options),
    date.toLocaleDateString('en-US', options),
    date.toLocaleDateString('en', options),
    String(date.getUTCDay()),
  ];

  for (const cand of candidates) {
    const alias = tokenToAlias(cand);
    if (alias) return alias;
  }

  const idx = date.getUTCDay();
  return DAY_ALIAS_ORDER[idx] || 'mon';
}

export function testMobileRoute(req, res) {
    res.json({ message: 'Ruta activa para el bloque: movil' })
}

export async function getDailyAvailability(req, res) {
    const { service_id, date } = req.query || {}
    if (!service_id || !date) {
        return res.status(400).json({ error: 'Faltan parametros: service_id o date' })
    }
    const formattedDate = new Date(date).toISOString().slice(0, 10)
    const dayAlias = getDayAliasForDate(formattedDate + "T00:00:00Z")
    const svcIdNum = Number(service_id)
    let connection
    try {
        connection = await req.db.getConnection()
        const [
            [timeslotRows],
            [coachRows],
            [bookingRows],
            [availabilityRows]
        ] = await Promise.all([
            connection.execute(`
        SELECT DISTINCT TIME_FORMAT(timeslot, '%H:%i:%s') AS timeslot
        FROM session_timeslots
        ORDER BY timeslot
      `),
            connection.execute(`
        SELECT ca.coach_id,
               u.user_name AS coach_name,
               ca.days,
               ca.service_id_morning,
               ca.service_id_afternoon,
               ca.capacity_morning,
               ca.capacity_afternoon
        FROM coach_availability ca
        JOIN users u ON u.user_id = ca.coach_id
        WHERE (ca.service_id_morning = ? OR ca.service_id_afternoon = ?)
          AND (ca.activacion IS NULL OR ca.activacion <= ?)
          AND (ca.desactivacion IS NULL OR ca.desactivacion > ?)
          AND u.deleted_at IS NULL
      `, [svcIdNum, svcIdNum, formattedDate, formattedDate]),
            connection.execute(`
        SELECT 
          b.service_id,
          DATE(b.start_date) AS date,
          TIME_FORMAT(st.timeslot, '%H:%i:%s') AS hour,
          coach.user_id AS coach_id,
          coach.user_name AS coach_name,
          COUNT(b.booking_id) AS booked,
          MAX(sv.limit) AS capacity,
          GROUP_CONCAT(customer.user_name SEPARATOR ', ') AS users
        FROM bookings b
        JOIN session_timeslots st ON b.session_timeslot_id = st.session_timeslot_id
        JOIN services sv ON b.service_id = sv.service_id
        JOIN users customer ON b.customer_id = customer.user_id
        JOIN users coach ON b.coach_id = coach.user_id
        WHERE 
          b.service_id = ?
          AND b.status = 'active'
          AND b.deleted_at IS NULL
          AND coach.deleted_at IS NULL
          AND DATE(b.start_date) = ?
        GROUP BY b.service_id, date, hour, coach.user_id
        ORDER BY hour, coach_name
      `, [svcIdNum, formattedDate]),
            connection.execute(`
        SELECT coach_id,
               days,
               TIME_FORMAT(morning_start_time, '%H:%i:%s')   AS morning_start_time,
               TIME_FORMAT(morning_end_time, '%H:%i:%s')     AS morning_end_time,
               capacity_morning,
               service_id_morning,
               TIME_FORMAT(afternoon_start_time, '%H:%i:%s') AS afternoon_start_time,
               TIME_FORMAT(afternoon_end_time, '%H:%i:%s')   AS afternoon_end_time,
               capacity_afternoon,
               service_id_afternoon
        FROM coach_availability
        WHERE (service_id_morning = ? OR service_id_afternoon = ?)
          AND (activacion IS NULL OR activacion <= ?)
          AND (desactivacion IS NULL OR desactivacion > ?)
      `, [svcIdNum, svcIdNum, formattedDate, formattedDate])
        ])

        const coachMap = new Map()
        for (const row of coachRows) {
            if (!matchesDayAlias(parseDayAliases(row.days), dayAlias)) continue
            const existing = coachMap.get(row.coach_id) || {
                coach_id: row.coach_id,
                coach_name: row.coach_name,
                service_id_morning: null,
                service_id_afternoon: null,
                capacity_morning: null,
                capacity_afternoon: null
            }
            if (row.service_id_morning != null) {
                existing.service_id_morning = Number(row.service_id_morning)
                existing.capacity_morning = Number(row.capacity_morning)
            }
            if (row.service_id_afternoon != null) {
                existing.service_id_afternoon = Number(row.service_id_afternoon)
                existing.capacity_afternoon = Number(row.capacity_afternoon)
            }
            coachMap.set(row.coach_id, existing)
        }
        const coaches = Array.from(coachMap.values())

    const bookingMap = {}
    for (const row of bookingRows) {
      const hour = row.hour.length === 5 ? row.hour + ':00' : row.hour
      const key = formattedDate + '_' + hour + '_' + row.coach_id
      bookingMap[key] = Number(row.booked) || 0
    }

        const availabilityMap = {}
        for (const row of availabilityRows) {
            const aliasSet = parseDayAliases(row.days)
            if (!matchesDayAlias(aliasSet, dayAlias)) continue
            const entry = availabilityMap[row.coach_id] || { morning: null, afternoon: null }
            if (row.morning_start_time && row.morning_end_time && Number(row.service_id_morning) === svcIdNum) {
                entry.morning = {
                    start: row.morning_start_time,
                    end: row.morning_end_time,
                    capacity: Number(row.capacity_morning) || 0
                }
            }
            if (row.afternoon_start_time && row.afternoon_end_time && Number(row.service_id_afternoon) === svcIdNum) {
                entry.afternoon = {
                    start: row.afternoon_start_time,
                    end: row.afternoon_end_time,
                    capacity: Number(row.capacity_afternoon) || 0
                }
            }
            availabilityMap[row.coach_id] = entry
        }

        const response = []
        for (const slot of timeslotRows) {
            const formattedSlot = slot.timeslot
            for (const coach of coaches) {
                const coachAvailability = availabilityMap[coach.coach_id]
                if (!coachAvailability) continue

                let coachAvailable = false
                let isMorning = false
                let capacity = 0
                const ranges = []
                if (coachAvailability.morning && coachAvailability.morning.start && coachAvailability.morning.end) {
                    ranges.push({ ...coachAvailability.morning, isMorning: true })
                }
                if (coachAvailability.afternoon && coachAvailability.afternoon.start && coachAvailability.afternoon.end) {
                    ranges.push({ ...coachAvailability.afternoon, isMorning: false })
                }

                for (const range of ranges) {
                    if (range.start <= formattedSlot && formattedSlot < range.end) {
                        const minute = parseInt(formattedSlot.split(':')[1], 10)

                        const isValidTime =
                            (range.isMorning && minute === 30) ||
                            (!range.isMorning && minute === 0)

                        if (isValidTime) {
                            coachAvailable = true
                            isMorning = range.isMorning
                            capacity = range.capacity
                            break
                        }
                    }
                }
                if (!coachAvailable) continue

                const coachServiceId = isMorning ? coach.service_id_morning : coach.service_id_afternoon
                if (Number(coachServiceId) !== svcIdNum) continue

                const key = formattedDate + '_' + formattedSlot + '_' + coach.coach_id

                response.push({
                    service_id: svcIdNum,
                    date: new Date(formattedDate).toISOString(),
                    hour: formattedSlot,
                    coach_id: coach.coach_id,
                    coach_name: coach.coach_name,
                    booked: bookingMap[key] || 0,
                    capacity: capacity || 0
                })
            }
        }
        connection.release()
        res.json(response)
    } catch (err) {
        console.error('[ERROR] /api/mobile/daily ->', err)
        res.status(500).json({ error: 'Error al consultar disponibilidad diaria', details: err.message })
    } finally {
        if (connection) await connection.release()
    }
}

export async function reserveSession(req, res) {
    const {
        customer_id,
        coach_id,
        session_timeslot_id,
        service_id,
        product_id,
        start_date,
        status = 'active'
    } = req.body || {};

    if (!customer_id || !coach_id || !session_timeslot_id || !service_id || !product_id || !start_date) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    let connection;
    try {
        connection = await req.db.getConnection();

        // Validación: evitar duplicados del mismo cliente en el mismo horario
        const [existing] = await connection.execute(`
            SELECT booking_id
            FROM bookings
            WHERE customer_id = ? AND session_timeslot_id = ? AND DATE(start_date) = DATE(?) AND status = 'active'
        `, [customer_id, session_timeslot_id, start_date]);

        if (existing.length > 0) {
            connection.release();
            return res.status(409).json({ error: 'Ya existe una reserva para este usuario y horario' });
        }

        // 🔍 Obtener payment_method y payment_status del producto activo
        const [[productoActivo]] = await connection.execute(`
            SELECT active_product_id, payment_method, payment_status
            FROM active_products
            WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL AND active_product_status = 'booked'
            ORDER BY created_at DESC
            LIMIT 1
        `, [customer_id, product_id]);

        console.log("Producto activo encontrado:", productoActivo);

        if (!productoActivo) {
            connection.release();
            return res.status(404).json({ error: 'Producto activo no encontrado para este usuario' });
        }

        const { payment_method, payment_status, active_product_id} = productoActivo;

        // Insertar nueva reserva
        const [result] = await connection.execute(`
            INSERT INTO bookings (
                active_product_id, customer_id, coach_id, session_timeslot_id,
                service_id, product_id, start_date,
                status, payment_status, payment_method, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            active_product_id, customer_id, coach_id, session_timeslot_id,
            service_id, product_id, start_date,
            status, payment_status, payment_method,
            new Date()
        ]);

        console.log("Datos insertados:", { result });

        connection.release();

        // Log activity
        try {
            await logActivity(req, {
                subject: `Usuario ${customer_id} reservó sesión con coach ${coach_id} el ${start_date}, active_product_id: ${active_product_id}`,
                userId: customer_id
            });
        } catch (logErr) {
            console.error("⚠️ Logging error (reserveSession):", logErr);
        }

        res.status(201).json({
            message: 'Reserva creada con éxito',
            booking_id: result.insertId
        });
    } catch (err) {
        console.error('[ERROR] POST /api/mobile/reserve →', err);
        res.status(500).json({ error: 'Error al insertar la reserva', details: err.message });
    } finally {
        if (connection) await connection.release();
    }
}

export async function getUserTrainingBookings(req, res) {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  const APRENDE_A_ENTRENAR_PRODUCT_ID = 61;
  let connection;
  try {
    connection = await req.db.getConnection();
    // Buscar si existe al menos una reserva del producto 61 con estado booked o active
    const [rows] = await connection.execute(
      `
       SELECT 1
       FROM bookings
       WHERE customer_id = ?
         AND product_id = ?
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [user_id, APRENDE_A_ENTRENAR_PRODUCT_ID]
    );
    const count = rows.length > 0 ? 1 : 0;
    return res.json({ count });  // se mantiene la propiedad 'count' por compatibilidad
  } catch (err) {
    console.error('[ERROR] GET /user-training-bookings →', err);
    return res.status(500).json({ error: 'Error retrieving training bookings' });
  } finally {
    if (connection) connection.release();
  }
}

export async function getTrainerReservationSlots(req, res) {
  const { date, shift } = req.query || {};
  const coachId = req?.user_payload?.id; // viene del verifyToken

  if (!date || !shift || !['morning', 'afternoon'].includes(shift)) {
    return res
      .status(400)
      .json({ error: 'Parámetros requeridos: date=YYYY-MM-DD & shift=morning|afternoon' });
  }
  if (!coachId) return res.status(401).json({ error: 'No autorizado' });

  let connection;
  try {
    connection = await req.db.getConnection();

    const dayAlias = getDayAliasForDate(date + 'T00:00:00Z');

    // 1️⃣ Obtener disponibilidad del coach
    const [availabilityRows] = await connection.execute(
      `
      SELECT 
        days,
        TIME_FORMAT(morning_start_time, '%H:%i:%s')   AS morning_start_time,
        TIME_FORMAT(morning_end_time, '%H:%i:%s')     AS morning_end_time,
        TIME_FORMAT(afternoon_start_time, '%H:%i:%s') AS afternoon_start_time,
        TIME_FORMAT(afternoon_end_time, '%H:%i:%s')   AS afternoon_end_time,
        service_id_morning,
        service_id_afternoon
      FROM coach_availability
      WHERE coach_id = ?
        AND (activacion IS NULL OR activacion <= ?)
        AND (desactivacion IS NULL OR desactivacion > ?)
    `,
      [coachId, date, date]
    );

    const rowsForDay = availabilityRows.filter(row =>
      matchesDayAlias(parseDayAliases(row.days), dayAlias)
    );

    if (!rowsForDay.length) {
      connection.release();
      return res.json([]);
    }

    const isMorning = shift === 'morning';
    let rangeStart = null;
    let rangeEnd = null;
    let svcForTurn = null;

    for (const row of rowsForDay) {
      const start = isMorning ? row.morning_start_time : row.afternoon_start_time;
      const end = isMorning ? row.morning_end_time : row.afternoon_end_time;
      const svc = isMorning ? row.service_id_morning : row.service_id_afternoon;
      if (start && end && start < end && svc) {
        rangeStart = start;
        rangeEnd = end;
        svcForTurn = svc;
        break;
      }
    }

    if (!rangeStart || !rangeEnd || rangeStart >= rangeEnd || !svcForTurn) {
      connection.release();
      return res.json([]);
    }

    // 2️⃣ Obtener el nombre del servicio actual
    const [[svcRow]] = await connection.execute(
      `SELECT service_name FROM services WHERE service_id = ? LIMIT 1`,
      [svcForTurn]
    );

    const serviceName = svcRow?.service_name?.toLowerCase() ?? '';

    // 3️⃣ Determinar si es Fisio/Nutri → 45 min o resto → 60 min
    const isFisioONutri =
      serviceName.includes('fisio') ||
      serviceName.includes('nutri') ||
      [3, 14].includes(Number(svcForTurn));

    // 4️⃣ Cargar slots reales desde session_timeslots
    const [timeslots] = await connection.execute(
      `
      SELECT DISTINCT TIME_FORMAT(timeslot, '%H:%i:%s') AS timeslot
      FROM session_timeslots
      WHERE service_id = ?
      ORDER BY timeslot
    `,
      [svcForTurn]
    );

    // 5️⃣ Filtrar los slots que estén dentro del rango horario
    const filtered = timeslots
      .map(row => row.timeslot)
      .filter(hhmmss => rangeStart <= hhmmss && hhmmss < rangeEnd);

    // Si el servicio no es Fisio/Nutri, filtrar solo horas en punto
    const validSlots = isFisioONutri
      ? filtered // conserva 45 min
      : filtered.filter(t => t.endsWith(':00')); // solo las horas exactas

    // 6️⃣ Consultar reservas existentes del coach para ese rango
    const [bookings] = await connection.execute(
      `
      SELECT 
        TIME_FORMAT(st.timeslot, '%H:%i:%s') AS time,
        COUNT(b.booking_id) AS total,
        MIN(s.service_name) AS service_name,
        GROUP_CONCAT(
          CONCAT(c.user_id, ':', c.user_name, ':', b.booking_id)
          ORDER BY c.user_name SEPARATOR '||'
        ) AS clients_raw
      FROM session_timeslots st
      LEFT JOIN bookings b
        ON b.session_timeslot_id = st.session_timeslot_id
       AND b.coach_id = ?
       AND DATE(b.start_date) = ?
       AND b.status = 'active'
       AND b.deleted_at IS NULL
      LEFT JOIN users c ON c.user_id = b.customer_id
      LEFT JOIN services s ON s.service_id = b.service_id
      WHERE st.timeslot >= ? 
        AND st.timeslot < ?
        AND st.service_id = ?
      GROUP BY time
      ORDER BY time
    `,
      [coachId, date, rangeStart, rangeEnd, svcForTurn]
    );

    const byTime = new Map(
      bookings.map(r => [r.time.length === 5 ? `${r.time}:00` : r.time, r])
    );

    // 7️⃣ Construir salida con clientes y recuentos
    const out = validSlots.map(t => {
      const hhmm = t.slice(0, 5);
      const r = byTime.get(t);
      const clients = [];

      if (r?.clients_raw) {
        for (const piece of r.clients_raw.split('||')) {
          const [id, name, bookingId] = piece.split(':');
          if (id) {
            clients.push({
              id: Number(id),
              name,
              bookingId: Number(bookingId) || null
            });
          }
        }
      }

      return {
        id: `${date}-${hhmm}`,
        time: hhmm,
        count: Number(r?.total || 0),
        label: r?.service_name || undefined,
        clients
      };
    });

    connection.release();
    return res.json(out);
  } catch (err) {
    console.error('[ERROR] /api/mobile/trainer/reservations/slots →', err);
    return res.status(500).json({ error: 'Error interno', details: err?.message });
  } finally {
    if (connection) await connection.release();
  }
}


export async function updateBooking(req, res) {
    const {
        booking_id,
        new_coach_id,
        new_service_id,
        new_product_id,
        new_session_timeslot_id,
        new_start_date
    } = req.body || {}

    if (!booking_id || !new_coach_id || !new_service_id || !new_product_id || !new_session_timeslot_id || !new_start_date) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios' })
    }

    let connection
    try {
        connection = await req.db.getConnection()

        // Verifica si la reserva existe
        const [existing] = await connection.execute(`
            SELECT booking_id FROM bookings WHERE booking_id = ?
        `, [booking_id])

        if (!existing.length) {
            connection.release()
            return res.status(404).json({ error: 'Reserva no encontrada' })
        }

        // Actualiza la reserva
        await connection.execute(`
            UPDATE bookings
            SET coach_id = ?, service_id = ?, product_id = ?, session_timeslot_id = ?, start_date = ?
            WHERE booking_id = ?
        `, [new_coach_id, new_service_id, new_product_id, new_session_timeslot_id, new_start_date, booking_id])

        connection.release()

        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `Reserva ${booking_id} actualizada: nuevo coach ${new_coach_id}, nueva fecha ${new_start_date}`,
                userId: req.user?.id || 0
            });
        } catch (logErr) {
            console.error("⚠️ Logging error (updateBooking):", logErr);
        }

        res.json({ message: 'Reserva actualizada correctamente' })
    } catch (err) {
        console.error('[ERROR] PUT /api/mobile/update-booking →', err)
        res.status(500).json({ error: 'Error al actualizar la reserva', details: err.message })
    } finally {
        if (connection) await connection.release()
    }
}

export async function getUserBookings(req, res) {
    const { user_id } = req.query || {}

    if (!user_id) {
        return res.status(400).json({ error: 'Falta el parámetro user_id' })
    }

    let connection
    try {
        connection = await req.db.getConnection()

        const baseUrl = 'https://api.humanperformcenter.com/api/profile_pic/'


        const [rows] = await connection.execute(`
            SELECT 
                b.booking_id AS id,
                DATE(b.start_date) AS date,
                TIME_FORMAT(st.timeslot, '%H:%i:%s') AS hour,
                sv.service_name AS service,
                sv.service_id AS service_id,
                coach.user_name AS coach_name,
                coach.profile_pic AS coach_profile_pic,
                b.product_id AS product_id
            FROM bookings b
            JOIN session_timeslots st ON b.session_timeslot_id = st.session_timeslot_id
            JOIN services sv ON b.service_id = sv.service_id
            JOIN users coach ON b.coach_id = coach.user_id
            WHERE 
                b.customer_id = ?
                AND b.status = 'active'
            ORDER BY b.start_date, st.timeslot
        `, [user_id])

        // Añadir la URL completa al profile_pic
        const bookings = rows.map(row => ({
            ...row,
            coach_profile_pic: row.coach_profile_pic 
                ? baseUrl + row.coach_profile_pic 
                : null
        }))

        res.json(bookings)
    } catch (err) {
        console.error('[ERROR] /api/mobile/user-bookings →', err)
        res.status(500).json({ error: 'Error al consultar las reservas', details: err.message })
    } finally {
        if (connection) await connection.release()
    }
}

export async function cancelBooking(req, res) {
    const bookingId = req.params.id

    if (!bookingId) {
        return res.status(400).json({ error: 'Falta el ID de la reserva' })
    }

    let connection
    try {
        connection = await req.db.getConnection()
        const [result] = await connection.execute(
            `UPDATE bookings SET status = 'canceled', updated_at = NOW() WHERE booking_id = ?`,
            [bookingId]
        )
        connection.release()

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Reserva no encontrada o ya cancelada' })
        }

        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `Reserva ${bookingId} fue cancelada por el usuario ${req.user?.id || 'sistema'}`,
                userId: req.user?.id || 0
            });
        } catch (logErr) {
            console.error("⚠️ Logging error (cancelBooking):", logErr);
        }

        res.json({ success: true, updated: result.affectedRows })
    } catch (err) {
        console.error('[ERROR] /booking/:id CANCEL →', err)
        res.status(500).json({ error: 'Error al cancelar reserva', details: err.message })
    } finally {
        if (connection) await connection.release()
    }
}


export async function recoverSession(req, res) {
  const {
    customer_id,
    coach_id,
    session_timeslot_id,
    service_id,
    product_id,
    start_date
  } = req.body || {};

  if (!customer_id || !coach_id || !session_timeslot_id || !service_id || !product_id || !start_date) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // Buscar producto activo
    const [[productoActivo]] = await connection.execute(`
      SELECT active_product_id, payment_method, payment_status
      FROM active_products
      WHERE customer_id = ? AND product_id = ? 
        AND deleted_at IS NULL 
        AND active_product_status = 'booked'
      ORDER BY created_at DESC
      LIMIT 1
    `, [customer_id, product_id]);

    if (!productoActivo) {
      connection.release();
      return res.status(404).json({ error: 'Producto activo no encontrado para este usuario' });
    }

    const { payment_method, payment_status, active_product_id } = productoActivo;

    // Insertar nueva reserva como "recuperada"
    const [result] = await connection.execute(`
      INSERT INTO bookings (
        active_product_id, customer_id, coach_id, session_timeslot_id,
        service_id, product_id, start_date,
        status, payment_status, payment_method, is_recovered, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      active_product_id, customer_id, coach_id, session_timeslot_id,
      service_id, product_id, start_date,
      'active', payment_status, payment_method, 1, new Date()
    ]);

    connection.release();

    // Log activity
    try {
      await logActivity(req, {
        subject: `Usuario ${customer_id} recuperó sesión con coach ${coach_id} el ${start_date}, active_product_id: ${active_product_id}`,
        userId: customer_id
      });
    } catch (logErr) {
      console.error("⚠️ Logging error (recoverSession):", logErr);
    }

    res.status(201).json({
      message: '✅ Sesión recuperada con éxito',
      booking_id: result.insertId
    });
  } catch (err) {
    console.error('[ERROR] POST /api/mobile/recover-session →', err);
    res.status(500).json({ error: 'Error al recuperar la sesión', details: err.message });
  } finally {
    if (connection) await connection.release();
  }
}



export async function getUserProduct(req, res) {
  const userId = parseInt(req.query.user_id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Parámetro user_id inválido o ausente' });
  }

  try {
    const [rows] = await req.db.execute(`
      SELECT product_id
      FROM active_products
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Este usuario no tiene productos asignados' });
    }

    res.json({ product_id: rows[0].product_id });
  } catch (err) {
    console.error('[ERROR] GET /user-product →', err);
    res.status(500).json({ error: 'Error al consultar el producto del usuario', details: err.message });
  }
}

export async function getUserServices(req, res) {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'Falta user_id' });

  try {
    const [rows] = await req.db.execute(`
      SELECT DISTINCT(ps.service_id), s.service_name 
      FROM product_services ps
      JOIN active_products ap ON ps.product_id = ap.product_id
      JOIN services s ON ps.service_id = s.service_id
      JOIN products p ON p.product_id = ps.product_id AND p.deleted_at IS NULL
      WHERE ap.customer_id = ? AND ap.deleted_at IS NULL
    `, [user_id]);

    const result = rows.map(row => ({ id: row.service_id, name: row.service_name }));
    res.json(result);
  } catch (err) {
    console.error('[ERROR] /mobile/user-services', err);
    res.status(500).json({ error: 'Error al consultar servicios del usuario', details: err.message });
  }
}

export async function getTimeslotId(req, res) {
    const { hour } = req.query || {}
    if (!hour) {
        return res.status(400).json({ error: 'Falta el parámetro hour' })
    }
    const formattedHour = hour.length === 5 ? hour + ':00' : hour
    try {
        const [rows] = await req.db.execute(`
      SELECT session_timeslot_id
      FROM session_timeslots
      WHERE TIME_FORMAT(timeslot, '%H:%i:%s') = ?
    `, [formattedHour])
        if (!rows.length) {
            return res.status(404).json({ error: 'Hora no encontrada' })
        }
        res.json({ session_timeslot_id: rows[0].session_timeslot_id })
    } catch (err) {
        console.error('[ERROR] GET /timeslot-id →', err)
        res.status(500).json({ error: 'Error al consultar timeslot' })
    }
}

export async function getPreferredCoach(req, res) {
  const { customer_id, service_id } = req.query || {}

  if (!customer_id || !service_id) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios' })
  }

  let connection
  try {
    connection = await req.db.getConnection()
    const [rows] = await connection.execute(`
      SELECT coach_id
      FROM preferred_coach
      WHERE customer_id = ? AND service_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `, [customer_id, service_id])

    connection.release()

    if (!rows.length) {
      return res.json({ coach_id: null })
    }

    res.json({ coach_id: rows[0].coach_id })
  } catch (err) {
    console.error('[ERROR] GET /mobile/preferred-coach →', err)
    res.status(500).json({ error: 'Error al consultar el entrenador preferido', details: err.message })
  } finally {
    if (connection) await connection.release()
  }
}

export async function getUserWeeklyLimit(req, res) {
  const { user_id, target_date } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: "Falta user_id" });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    // 🔹 Productos activos del usuario
    const [rows] = await connection.execute(
      `
      SELECT 
        ap.active_product_id,
        ap.product_id,
        ap.created_at AS ap_created_at,
        ap.expiry_date,
        p.type_of_product,
        p.total_session,
        p.valid_due
      FROM active_products ap
      JOIN products p ON ap.product_id = p.product_id
      WHERE ap.customer_id = ?
        AND ap.active_product_status = 'booked'
        AND (ap.expiry_date IS NULL OR ap.expiry_date >= CURDATE())
        AND (ap.deleted_at IS NULL OR ap.deleted_at > NOW())
        AND ap.is_canceled_subscription = 0
      `,
      [user_id]
    );

    if (!rows.length) {
      return res.json({ weekly_limits: [] });
    }

    // Agrupar por producto y tomar el active_product más reciente
    const latestByProduct = new Map();
    for (const r of rows) {
      const productId = Number(r.product_id);
      if (!productId) continue;

      const current = latestByProduct.get(productId);
      const currentTs = current && current.ap_created_at
        ? new Date(current.ap_created_at).getTime()
        : -Infinity;
      const candidateTs = r.ap_created_at
        ? new Date(r.ap_created_at).getTime()
        : -Infinity;

      if (!current || candidateTs > currentTs) {
        latestByProduct.set(productId, r);
      }
    }

    // Semana de referencia
    const base = target_date ? new Date(target_date) : new Date();
    const day = base.getDay() || 7;
    const monday = new Date(base);
    monday.setDate(base.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const result = [];

    for (const r of latestByProduct.values()) {
      let weeklyLimit = r.total_session || 0;

      // 👇 si en product_services hay override de sesiones → usarlo
      const [srv] = await connection.execute(
        `
        SELECT session
        FROM product_services
        WHERE product_id = ?
        LIMIT 1
        `,
        [r.product_id]
      );
      if (srv.length && srv[0].session != null) {
        weeklyLimit = srv[0].session;
      }

      let used = 0;

      if (r.type_of_product === "recurrent") {
        // 🔹 recurrente → contar SOLO las reservas activas de la semana
        const startDate = new Date(
          Math.max(monday.getTime(), new Date(r.ap_created_at).getTime())
        );
        const endDate = r.expiry_date
          ? new Date(Math.min(sunday.getTime(), new Date(r.expiry_date).getTime()))
          : sunday;

        const [bookings] = await connection.execute(
          `
          SELECT COUNT(*) AS used
          FROM bookings
          WHERE customer_id = ?
            AND active_product_id = ?
            AND status = 'active'
            AND YEARWEEK(start_date, 1) = YEARWEEK(?, 1)
          `,
          [user_id, r.active_product_id, target_date]
        );

        used = bookings[0].used || 0;

        result.push({
          active_product_id: r.active_product_id,
          product_id: r.product_id,
          type_of_product: r.type_of_product,
          weekly_limit: weeklyLimit,
          total_limit: null,
          used,
          remaining: Math.max(0, weeklyLimit - used),
        });
      } else {
        // 🔹 bonos (single_session / multi_sessions)
        // respetar validez (created_at + valid_due)
        let stillValid = true;
        if (r.valid_due) {
          const validUntil = new Date(r.ap_created_at);
          validUntil.setDate(validUntil.getDate() + Number(r.valid_due));
          stillValid = validUntil >= new Date();
        }

        if (!stillValid) {
          continue; // caducado → ignorar
        }

        const totalLimit = r.total_session ?? weeklyLimit;

        const [bookings] = await connection.execute(
          `
          SELECT COUNT(*) AS used
          FROM bookings
          WHERE customer_id = ?
            AND active_product_id = ?
            AND status = 'active'
          `,
          [user_id, r.active_product_id]
        );
        used = bookings[0].used || 0;

        const remaining =
          totalLimit != null ? Math.max(0, totalLimit - used) : null;

        result.push({
          active_product_id: r.active_product_id,
          product_id: r.product_id,
          type_of_product: r.type_of_product,
          weekly_limit: null,
          total_limit: totalLimit,
          used,
          remaining,
        });
      }
    }

    res.json({ weekly_limits: result });
  } catch (err) {
    console.error("[ERROR] GET /user-weekly-limit:", err);
    res
      .status(500)
      .json({ error: "Error al calcular límite semanal", details: err.message });
  } finally {
    if (connection) connection.release();
  }
}


export async function getUserWeeklyLimitTrucho(req, res) {
  const { user_id } = req.query;

  if (isNaN(user_id)) {
    return res.status(400).json({ error: 'Parámetro user_id inválido o ausente' });
  }

  try {
    const [productos] = await req.db.execute(`
      SELECT 
      p.type_of_product,
      MAX(ps.session) AS product_session,
      ps.primary_service_id AS service_id,
      p.total_session,
      p.valid_due,
      p.product_id,
      p.deleted_at,
      ap.created_at AS user_product_created_at,
      ap.expiry_date AS user_product_expiry_date,  
      ap.deleted_at AS ap_deleted_at                
    FROM active_products ap
    JOIN products p ON ap.product_id = p.product_id
    LEFT JOIN product_services ps ON ps.product_id = p.product_id
    WHERE ap.customer_id = ?
      AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
      AND (ap.deleted_at IS NULL OR ap.deleted_at > NOW())
      AND ap.active_product_status = 'booked'
    GROUP BY p.product_id, ps.primary_service_id
    `, [user_id]);

    const [mapRows] = await req.db.execute(`
      SELECT s.service_id, sp.primary_service_id
      FROM services s
      LEFT JOIN service_primary sp ON sp.service_id = s.service_id
      WHERE s.deleted_at IS NULL
    `);

    const serviceToPrimary = {};
    for (const r of mapRows) {
      if (r.primary_service_id) {
        serviceToPrimary[r.service_id] = r.primary_service_id;
      }
    }

    if (!productos.length) {
      return res.status(404).json({ error: 'Este usuario no tiene productos activos' });
    }

    const weeklyLimit = {};
    const unlimitedSessions = {};
    const now = new Date();

    // --- Detectar productos multi-primario y construir pools compartidos con ventanas ---
    const [multiRows] = await req.db.execute(`
      SELECT 
        ps.product_id,
        GROUP_CONCAT(DISTINCT ps.primary_service_id ORDER BY ps.primary_service_id) AS primary_ids
      FROM product_services ps
      JOIN active_products ap ON ap.product_id = ps.product_id
      JOIN products p        ON p.product_id = ps.product_id
      WHERE ap.customer_id = ?
        AND ps.primary_service_id IS NOT NULL
        AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
        AND (ap.deleted_at IS NULL OR ap.deleted_at > NOW())
        AND ap.active_product_status = 'booked'
      GROUP BY ps.product_id
    `, [user_id]);

    const multiProductIds = new Set();  
    const unlimited_shared = [];

    const productInfo = new Map(productos.map(p => [p.product_id, p]));

    for (const row of multiRows) {
      const ids = String(row.primary_ids || '')
        .split(',')
        .map(x => parseInt(x, 10))
        .filter(n => !isNaN(n));

      if (ids.length >= 2) {
        multiProductIds.add(row.product_id);

        const info = productInfo.get(row.product_id);
        if (!info) continue;

        const sesiones = (info.product_session ?? info.total_session ?? 0);
        if (!sesiones) continue;

        const createdAt = new Date(info.user_product_created_at);
        const expiresAt =
          info.user_product_expiry_date ? new Date(info.user_product_expiry_date) :
          ( () => { const d = new Date(createdAt); d.setDate(d.getDate() + (info.valid_due ?? 0)); return d; } )();

        // Si el AP fue marcado como deleted antes del expiry, usar esa fecha como límite superior
        const hardStop = info.ap_deleted_at ? new Date(info.ap_deleted_at) : null;
        const validTo = hardStop && hardStop < expiresAt ? hardStop : expiresAt;

        const isValid = (info.type_of_product === 'recurrent') || (now <= validTo);
        if (!isValid) continue;

        if (info.type_of_product === 'single_session' || info.type_of_product === 'multi_sessions') {
          unlimited_shared.push({
            services: ids,
            sessions: sesiones,
            valid_from: createdAt.toISOString(),
            valid_to: validTo ? validTo.toISOString() : null
          });
        }
      }
    }

    // --- Tu lógica original para límites (con skip si es multi-primario) ---
    for (const producto of productos) {
      const {
        type_of_product: tipo,
        product_session: session,
        total_session: total,
        service_id,
        valid_due,
        user_product_created_at,
        user_product_expiry_date,
        ap_deleted_at,
        product_id
      } = producto;

      if (!service_id) continue;

      const sesiones = session ?? total ?? 0;
      if (!sesiones) continue;

      const createdAt = new Date(user_product_created_at);
      const expiresAt =
        user_product_expiry_date ? new Date(user_product_expiry_date) :
        ( () => { const d = new Date(createdAt); d.setDate(d.getDate() + (valid_due ?? 0)); return d; } )();

      const hardStop = ap_deleted_at ? new Date(ap_deleted_at) : null;
      const validTo = hardStop && hardStop < expiresAt ? hardStop : expiresAt;

      const isValid = tipo === 'recurrent' || now <= validTo;
      if (!isValid) continue;

      if (tipo === 'recurrent') {
          weeklyLimit[service_id] = Math.max(weeklyLimit[service_id] ?? 0, sesiones);
      } else if (tipo === 'single_session' || tipo === 'multi_sessions') {
        if (multiProductIds.has(product_id)) {
          continue; // este ya se cuenta en unlimited_shared
        }
        unlimitedSessions[service_id] = (unlimitedSessions[service_id] ?? 0) + sesiones;
      }
    }

    // --- NUEVO: valid_from_by_primary (para filtrar consumo dedicado del bono actual) ---
    const [validFromRows] = await req.db.execute(`
      SELECT 
        ps.primary_service_id,
        MAX(ap.created_at) AS valid_from
      FROM product_services ps
      JOIN active_products ap ON ap.product_id = ps.product_id
      JOIN products p        ON p.product_id = ps.product_id
      WHERE ap.customer_id = ?
        AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
        AND (ap.deleted_at IS NULL OR ap.deleted_at > NOW())
        AND ap.active_product_status = 'booked'
      GROUP BY ps.primary_service_id
    `, [user_id]);

    const valid_from_by_primary = {};
    for (const r of validFromRows) {
      if (r.primary_service_id && r.valid_from) {
        valid_from_by_primary[r.primary_service_id] = new Date(r.valid_from).toISOString();
      }
    }

    res.json({
      weekly_limit: weeklyLimit,
      unlimited_sessions: unlimitedSessions,
      unlimited_shared,                 // ahora con valid_from / valid_to
      service_to_primary: serviceToPrimary,
      valid_from_by_primary             // ⬅️ añadido
    });
  } catch (err) {
    console.error('[ERROR] GET /user-weekly-limit →', err);
    res.status(500).json({ error: 'Error al calcular el límite semanal', details: err.message });
  }
}

export async function getHolidays(req, res) {
  try {
    const [rows] = await req.db.execute(`
      SELECT date
      FROM holidays
      WHERE date >= CURDATE()
      ORDER BY date ASC
    `);

    if (!rows.length) {
      return res.status(404).json({ error: 'No hay días festivos próximos' });
    }

    const holidays = rows.map(row => row.date.toISOString().slice(0, 10));
    res.json(holidays);
  } catch (err) {
    console.error('[ERROR] GET /holidays →', err);
    res.status(500).json({ error: 'Error al consultar los días festivos', details: err.message });
  }
}

export async function submitBookingQuestionnaire(req, res) {
  const { booking_id, estado } = req.body || {}

  if (!booking_id || !estado) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' })
  }

  let connection
  try {
    connection = await req.db.getConnection()

    // Verificar que la reserva existe
    const [existing] = await connection.execute(`
      SELECT booking_id FROM bookings WHERE booking_id = ?
    `, [booking_id])

    if (!existing.length) {
      return res.status(404).json({ error: 'Reserva no encontrada' })
    }

    // Verificar que no exista ya cuestionario
    const [exists] = await connection.execute(`
      SELECT id FROM booking_questionnaire WHERE booking_id = ?
    `, [booking_id])

    if (exists.length) {
      return res.status(409).json({ error: 'Ya se ha enviado el cuestionario para esta reserva' })
    }

    // Insertar solo estado, demás NULL
    await connection.execute(`
      INSERT INTO booking_questionnaire (
        booking_id, Estado, sleep_quality, energy_level,
        muscle_pain, stress_level, mood
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL)
    `, [booking_id, estado])

    connection.release()
    res.status(201).json({ message: 'Cuestionario guardado correctamente' })

  } catch (err) {
    console.error('[ERROR] POST /booking-questionnaire →', err)
    res.status(500).json({ error: 'Error al guardar el cuestionario', details: err.message })
  } finally {
    if (connection) await connection.release()
  }
}

export async function getBookingQuestionnaireStatus(req, res) {
  const bookingId = parseInt(req.params.booking_id)
  if (isNaN(bookingId)) {
    return res.status(400).json({ error: 'ID de reserva inválido' })
  }

  let connection
  try {
    connection = await req.db.getConnection()
    const [rows] = await connection.execute(
      `SELECT Estado FROM booking_questionnaire WHERE booking_id = ? LIMIT 1`,
      [bookingId]
    )
    connection.release()

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No encontrado' })
    }

    return res.json({ estado: rows[0].Estado }) // 👈 devuelve el valor
  } catch (err) {
    console.error('[ERROR] GET /mobile/booking-questionnaire/:id →', err)
    if (connection) connection.release()
    return res.status(500).json({ error: 'Error al consultar cuestionario', details: err.message })
  }
}
