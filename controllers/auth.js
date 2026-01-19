import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { sendResetEmail } from '../services/mailerService.js'
import { logActivity } from "../utils/logger.js"

export async function registerUser(req, res) {
    const {
        nombre,
        apellidos,
        email: rawEmail,
        telefono,
        password,
        sexo,
        fecha_nacimiento: fechaNacimientoRaw,
        codigo_postal: codigoPostal,
        direccion_postal: direccionPostal,
        dni,
        device_type: deviceType
    } = req.body || {}

    const profilePicFilename = req.file ? req.file.filename : null

    // Validación de campos obligatorios (sin tutor todavía)
    const required = { nombre, apellidos, rawEmail, telefono, password, fechaNacimientoRaw, codigoPostal }
    const missing = Object.entries(required).filter(([_, v]) => !v).map(([k]) => k)
    if (missing.length) {
        return res.status(400).json({ error: `Faltan campos: ${missing.join(', ')}` })
    }

    // Parseo de fecha y cálculo de edad
    const d = fechaNacimientoRaw.slice(0, 2);
    const m = fechaNacimientoRaw.slice(2, 4);
    const y = fechaNacimientoRaw.slice(4, 8);
    const dt = new Date(`${y}-${m}-${d}`);
    if (isNaN(dt.getTime())) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Usa ddMMyyyy' })
    }
    const fechaSql = dt.toISOString().split('T')[0]

    const hoy = new Date()
    let edad = hoy.getFullYear() - dt.getFullYear()
    const mes = hoy.getMonth() - dt.getMonth()
    if (mes < 0 || (mes === 0 && hoy.getDate() < dt.getDate())) edad--

    const email = rawEmail.trim().toLowerCase()

    let connection
    try {
        connection = await req.db.getConnection()
        await connection.beginTransaction()

        // Verificar existencia de usuario
        const [exists] = await connection.execute('SELECT 1 FROM users WHERE email = ?', [email])
        if (exists.length) {
            return res.status(409).json({ error: 'El email ya está en uso' })
        }

        if (dni) {
            const [existsDni] = await connection.execute(
                'SELECT email FROM users WHERE dni = ?',
                [dni.trim()]
            );
            if (existsDni.length) {
                const associatedEmail = existsDni[0].email;
                return res.status(409).json({
                    error: `El DNI ya está asociado al correo: ${associatedEmail}`
                });
            }
        }

        // Hashear contraseña e insertar usuario
        const hashedPassword = await bcrypt.hash(password, 10)
        const sexoLimpio = sexo ? sexo.trim() : null;
        const direccionPostalLimpia = direccionPostal ? direccionPostal.trim() : null;
        const dniLimpio = dni ? dni.trim() : null;

        const nombreCompleto = `${nombre.trim()} ${apellidos.trim()}`
        const [resultUser] = await connection.execute(
            `INSERT INTO users
            (user_name, email, password, phone, sex, date_of_birth, postal_code, dni, address, profile_pic, device_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [nombreCompleto, email, hashedPassword, telefono.trim(), sexoLimpio,
                fechaSql, codigoPostal.trim(), dniLimpio, direccionPostalLimpia, profilePicFilename, deviceType]
        )

        const userId = resultUser.insertId

        await connection.commit()

        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `Registered new user: ${email}`,
                userId: userId
            })
        } catch (logErr) {
            console.error("⚠️ Logging error (registerUser):", logErr)
        }

        return res.status(201).json({ message: 'Se ha creado el registro correctamente' })
    } catch (err) {
        console.error('Error en registerUser:', err)
        if (connection) await connection.rollback()
        return res.status(500).json({ error: 'Error interno al crear el usuario' })
    } finally {
        if (connection) connection.release()
    }
}

export async function updateUserPayInfo(req, res) {
  const { user_id, dni, direccionPostal } = req.body || {};

  if (!user_id) {
    return res.status(400).json({ error: 'Falta user_id' });
  }

  if (!dni && !direccionPostal) {
    return res.status(400).json({ error: 'Debe enviar al menos un campo (dni o direccionPostal)' });
  }

  let connection;
  try {
    connection = await req.db.getConnection();

    const updates = [];
    const values = [];

    if (dni) {
      updates.push('dni = ?');
      values.push(dni.trim());
    }

    if (direccionPostal) {
      updates.push('address = ?');
      values.push(direccionPostal.trim());
    }

    values.push(user_id);

    await connection.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
      values
    );

    await logActivity(req, {
      subject: `Updated user info (dni/direccionPostal) for user ${user_id}`,
      userId: user_id
    });

    return res.json({ message: 'Datos actualizados correctamente' });
  } catch (err) {
    console.error('Error en updateUserInfo:', err);
    return res.status(500).json({ error: 'Error interno al actualizar los datos' });
  } finally {
    if (connection) connection.release();
  }
}


export async function loginUser(req, res) {
    const { email: rawEmail, password: rawPassword } = req.body || {}
    if (!rawEmail || !rawPassword) {
        return res.status(400).json({ error: 'Se requiere email y contraseña' })
    }

    let connection
    try {
        connection = await req.db.getConnection()
        await connection.beginTransaction()

        const email = rawEmail.trim().toLowerCase()
        const [rows] = await connection.execute('SELECT * FROM users WHERE email = ?', [email])
        await connection.commit()

        if (!rows.length) {
            return res.status(401).json({ error: 'Credenciales inválidas' })
        }
        const user = rows[0]

        const match = await bcrypt.compare(rawPassword, user.password)
        if (!match) {
            return res.status(401).json({ error: 'Credenciales inválidas' })
        }

        // 🔑 Usa JWT_SECRET unificado
        const accessToken = jwt.sign(
            { id: user.user_id, email: user.email, role: user.type || 'coach', type: 'access' },
            process.env.SECRET_JWT_KEY,
            { expiresIn: '15m' }
        )
        const refreshToken = jwt.sign(
            { id: user.user_id, email: user.email, role: user.type || 'coach', type: 'refresh' },
            process.env.SECRET_JWT_KEY,
            { expiresIn: '7d' }
        )

        // Preparar campos del perfil asegurando que NUNCA queden como undefined
        const dateOfBirth = user.date_of_birth
            ? new Date(user.date_of_birth).toISOString().split('T')[0]
            : null;

        return res.status(200).json({
            id: user.user_id,
            fullName: user.user_name ?? '',
            email: user.email ?? '',
            phone: user.phone ?? '',
            sex: user.sex ?? '',
            dateOfBirth,                                      // String (YYYY-MM-DD) o null
            postcode: user.postal_code != null ? Number(user.postal_code) : null, // Int? en KMM
            postAddress: user.address ?? '',
            dni: user.dni ?? null,
            profilePictureName: user.profile_pic ?? null,
            accessToken,
            refreshToken
        })
    } catch (err) {
        console.error('Error en loginUser:', err)
        return res.status(500).json({ error: 'Error interno al iniciar sesión' })
    } finally {
        if (connection) connection.release()
    }
}

export async function refreshTokenController(req, res) {
    const authHeader = req.headers.authorization || ''
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Refresh token requerido' })
    }
    const oldRefresh = authHeader.slice(7)

    let payload
    try {
        payload = jwt.verify(oldRefresh, process.env.SECRET_JWT_KEY)
    } catch {
        return res.status(401).json({ error: 'Refresh token inválido o expirado' })
    }

    if (payload.type !== 'refresh') {
        return res.status(401).json({ error: 'Token no es de tipo refresh' })
    }

    // 1. Generar siempre un nuevo access token
    const newAccess = jwt.sign(
        { id: payload.id, email: payload.email, type: 'access' },
        process.env.SECRET_JWT_KEY,
        { expiresIn: '15m' }
    )

    // 2. Decidir si generar refreshToken nuevo o reutilizar el existente
    const nowSec = Math.floor(Date.now() / 1000)
    const expiresInSec = payload.exp - nowSec
    const THRESHOLD = 24 * 60 * 60 // 24 horas

    let newRefresh = oldRefresh
    if (expiresInSec <= 0 || expiresInSec < THRESHOLD) {
        // ya expiró o está a punto de expirar en menos de 24 h → lo rotamos
        newRefresh = jwt.sign(
            { id: payload.id, email: payload.email, type: 'refresh' },
            process.env.SECRET_JWT_KEY,
            { expiresIn: '7d' }
        )
    }

    return res.status(200).json({
        accessToken: newAccess,
        refreshToken: newRefresh
    })
}

export async function changePassword(req, res) {
    const { currentPassword, newPassword, userId } = req.body || {}
    const userIdToken = req.user_payload.id

    console.log('🔍 change-password payload:', { userId, userIdToken })
    if (userId !== userIdToken) {
        console.log('❌ userId mismatch:', userId, userIdToken)
        return res.status(401).json({ error: 'No estás autorizado' })
    }

    if (!currentPassword || !newPassword || !userId) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' })
    }

    let connection

    try {
        connection = await req.db.getConnection()
        await connection.beginTransaction()

        const [rows] = await connection.execute(
            'SELECT password FROM users WHERE user_id = ?',
            [userId]
        )

        await connection.commit()

        if (!rows.length) {
            return res.status(404).json({ error: 'Usuario no encontrado' })
        }

        const storedHash = rows[0].password

        const match = await bcrypt.compare(currentPassword, storedHash)
        if (!match) {
            return res.status(401).json({ error: 'La contraseña actual es incorrecta' })
        }

        const newHash = await bcrypt.hash(newPassword, 10)
        await req.db.execute(
            'UPDATE users SET password = ? WHERE user_id = ?',
            [newHash, userId]
        )

        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `User ${userId} changed their password`,
                userId
            })
        } catch (logErr) {
            console.error("⚠️ Logging error (changePassword):", logErr)
        }

        return res.status(200).json({ message: 'Has cambiado la contraseña exitosamente' })
    } catch (err) {
        if (connection) await connection.rollback()
        return res.status(500).json({ error: err.message })
    } finally {
        if (connection) connection.release()
    }
}

export async function resetPassword(req, res) {
    const { email } = req.body
    if (!email) {
        return res.status(400).json({ error: 'Falta el email' })
    }

    let connection

    try {
        connection = await req.db.getConnection()
        await connection.beginTransaction()

        const length = 12

        const newPass = crypto
            .randomBytes(Math.ceil(length * 0.75))
            .toString('base64')
            .slice(0, length)
            .replace(/\+/g, 'A')
            .replace(/\//g, 'B')

        const hash = await bcrypt.hash(newPass, 10)

        const [result] = await connection.execute(
            'UPDATE users SET password = ? WHERE email = ?',
            [hash, email]
        )

        if (result.affectedRows === 0) {
            await connection.rollback()
            return res.status(404).json({ error: 'Usuario no encontrado' })
        }

        await connection.commit()

        try {
            await sendResetEmail(email, newPass)
            console.log('Email enviado a:', email)
        } catch (emailError) {
            console.error('Error enviando email:', emailError)
            await connection.rollback()
            return res.status(500).json({ error: 'Error al enviar el correo' })
        }
        // ✅ Log activity
        try {
            await logActivity(req, {
                subject: `Contraseña restablecida para el usuario: ${email}`,
                userId: 0  // Si no tienes al user_id, se coloca 0 como sistema
            })
        } catch (logErr) {
            console.error("⚠️ Logging error (resetPassword):", logErr)
        }

        return res.json({ message: 'Contraseña restablecida. Revisa tu correo.' })

    } catch (err) {
        console.error('resetPassword error:', err);
        if (connection) await connection.rollback();
        return res.status(500).json({ error: 'Error al restablecer la contraseña' });
    } finally {
        if (connection) connection.release();
    }
}
