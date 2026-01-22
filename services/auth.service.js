import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import * as authRepo from "../repositories/auth.repository.js";
import { sendResetEmail } from './mailer.service.js';

/**
 * Lógica para registrar usuario
 */
export async function registerUserService(dbPool, userData) {
    const {
        nombre, apellidos, rawEmail, telefono, password,
        fechaNacimientoRaw, codigoPostal, direccionPostal, dni, sexo, deviceType,
        profilePicFilename
    } = userData;

    // 1. Validaciones y Parsing
    const required = { nombre, apellidos, rawEmail, telefono, password, fechaNacimientoRaw, codigoPostal };
    const missing = Object.entries(required).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length) throw { status: 400, message: `Faltan campos: ${missing.join(', ')}` };

    const d = fechaNacimientoRaw.slice(0, 2);
    const m = fechaNacimientoRaw.slice(2, 4);
    const y = fechaNacimientoRaw.slice(4, 8);
    const dt = new Date(`${y}-${m}-${d}`);
    if (isNaN(dt.getTime())) throw { status: 400, message: 'Formato de fecha inválido. Usa ddMMyyyy' };

    const fechaSql = dt.toISOString().split('T')[0];
    const email = rawEmail.trim().toLowerCase();

    // Lógica de edad (opcional guardarla o solo validarla)
    // ... cálculo de edad omitido por brevedad si no se guarda en BD ...

    let connection;
    try {
        connection = await dbPool.getConnection();
        await connection.beginTransaction();

        // 2. Comprobar duplicados
        const existingUser = await authRepo.findUserByEmail(connection, email);
        if (existingUser) throw { status: 409, message: 'El email ya está en uso' };

        if (dni) {
            const existingDni = await authRepo.findUserByDni(connection, dni.trim());
            if (existingDni) {
                throw { status: 409, message: `El DNI ya está asociado al correo: ${existingDni.email}` };
            }
        }

        // 3. Hash y Creación
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = await authRepo.createUser(connection, {
            nombreCompleto: `${nombre.trim()} ${apellidos.trim()}`,
            email,
            hashedPassword,
            telefono: telefono.trim(),
            sexo: sexo ? sexo.trim() : null,
            fechaSql,
            codigoPostal: codigoPostal.trim(),
            dni: dni ? dni.trim() : null,
            direccionPostal: direccionPostal ? direccionPostal.trim() : null,
            profilePicFilename,
            deviceType
        });

        await connection.commit();
        return { userId, email };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Lógica de Login
 */
export async function loginUserService(dbPool, { email: rawEmail, password: rawPassword }) {
    if (!rawEmail || !rawPassword) throw { status: 400, message: 'Se requiere email y contraseña' };

    const email = rawEmail.trim().toLowerCase();

    // Login suele ser lectura, a veces no requiere transacción explicita si es una sola query,
    // pero mantenemos el patrón de conexión.
    const connection = await dbPool.getConnection();
    let user;
    try {
        user = await authRepo.findUserByEmail(connection, email);
    } finally {
        connection.release();
    }

    if (!user) throw { status: 401, message: 'Credenciales inválidas' };

    const match = await bcrypt.compare(rawPassword, user.password);
    if (!match) throw { status: 401, message: 'Credenciales inválidas' };

    // Generar Tokens
    const accessToken = jwt.sign(
        { id: user.user_id, email: user.email, role: user.type || 'coach', type: 'access' },
        process.env.SECRET_JWT_KEY,
        { expiresIn: '15m' }
    );
    const refreshToken = jwt.sign(
        { id: user.user_id, email: user.email, role: user.type || 'coach', type: 'refresh' },
        process.env.SECRET_JWT_KEY,
        { expiresIn: '7d' }
    );

    const dateOfBirth = user.date_of_birth
        ? new Date(user.date_of_birth).toISOString().split('T')[0]
        : null;

    return {
        user: {
            id: user.user_id,
            fullName: user.user_name ?? '',
            email: user.email ?? '',
            phone: user.phone ?? '',
            sex: user.sex ?? '',
            dateOfBirth,
            postcode: user.postal_code != null ? Number(user.postal_code) : null,
            postAddress: user.address ?? '',
            dni: user.dni ?? null,
            profilePictureName: user.profile_pic ?? null
        },
        accessToken,
        refreshToken
    };
}

/**
 * Lógica Refresh Token (pura, no necesita DB a menos que quieras blacklist)
 */
export function refreshTokensService(oldRefresh) {
    let payload;
    try {
        payload = jwt.verify(oldRefresh, process.env.SECRET_JWT_KEY);
    } catch {
        throw { status: 401, message: 'Refresh token inválido o expirado' };
    }

    if (payload.type !== 'refresh') throw { status: 401, message: 'Token no es de tipo refresh' };

    const newAccess = jwt.sign(
        { id: payload.id, email: payload.email, type: 'access' },
        process.env.SECRET_JWT_KEY,
        { expiresIn: '15m' }
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresInSec = payload.exp - nowSec;
    const THRESHOLD = 24 * 60 * 60; // 24 horas

    let newRefresh = oldRefresh;
    if (expiresInSec <= 0 || expiresInSec < THRESHOLD) {
        newRefresh = jwt.sign(
            { id: payload.id, email: payload.email, type: 'refresh' },
            process.env.SECRET_JWT_KEY,
            { expiresIn: '7d' }
        );
    }

    return { accessToken: newAccess, refreshToken: newRefresh };
}

/**
 * Actualizar datos de pago
 */
export async function updatePayInfoService(dbPool, { user_id, dni, direccionPostal }) {
    if (!user_id) throw { status: 400, message: 'Falta user_id' };
    if (!dni && !direccionPostal) throw { status: 400, message: 'Debe enviar al menos un campo' };

    let connection;
    try {
        connection = await dbPool.getConnection();
        const updates = [];
        const values = [];

        if (dni) { updates.push('dni = ?'); values.push(dni.trim()); }
        if (direccionPostal) { updates.push('address = ?'); values.push(direccionPostal.trim()); }

        await authRepo.updateUserPayInfo(connection, user_id, updates, values);
        return { user_id };
    } catch (err) {
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Cambiar contraseña
 */
export async function changePasswordService(dbPool, { currentPassword, newPassword, userId, userIdToken }) {
    if (userId !== userIdToken) throw { status: 401, message: 'No estás autorizado' };
    if (!currentPassword || !newPassword || !userId) throw { status: 400, message: 'Faltan campos' };

    let connection;
    try {
        connection = await dbPool.getConnection();
        await connection.beginTransaction();

        const user = await authRepo.findUserById(connection, userId);
        if (!user) throw { status: 404, message: 'Usuario no encontrado' };

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) throw { status: 401, message: 'La contraseña actual es incorrecta' };

        const newHash = await bcrypt.hash(newPassword, 10);
        await authRepo.updateUserPassword(connection, userId, newHash);

        await connection.commit();
        return { userId };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Restablecer contraseña (olvido)
 */
export async function resetPasswordService(dbPool, email) {
    if (!email) throw { status: 400, message: 'Falta el email' };

    const length = 12;
    const newPass = crypto.randomBytes(Math.ceil(length * 0.75)).toString('base64')
        .slice(0, length).replace(/\+/g, 'A').replace(/\//g, 'B');

    const hash = await bcrypt.hash(newPass, 10);
    let connection;

    try {
        connection = await dbPool.getConnection();
        await connection.beginTransaction();

        const updated = await authRepo.updatePasswordByEmail(connection, email, hash);
        if (!updated) {
            await connection.rollback();
            throw { status: 404, message: 'Usuario no encontrado' };
        }

        // Importante: Enviar email antes de commit definitivo o manejar el error de email
        // En tu código original, si falla el email, haces rollback.
        try {
            await sendResetEmail(email, newPass);
        } catch (emailError) {
            await connection.rollback();
            throw { status: 500, message: 'Error al enviar el correo' };
        }

        await connection.commit();
        return { email };
    } catch (err) {
        if (connection && connection.rollback) await connection.rollback(); // check rollback fn exists just in case
        throw err;
    } finally {
        if (connection) connection.release();
    }
}
