// user.service.js
import fs from 'fs'
import path, { join } from 'path'
import { promisify } from 'util'
import * as userRepo from '../repositories/user.repository.js'
import { UPLOAD_PATH } from "../middlewares/uploadProfile_Pic.js"

const unlinkAsync = promisify(fs.unlink)

// --- Helpers ---
function csvToArr(csv) {
    if (csv == null || csv === "") return [];
    return String(csv).split(",").map(s => s.trim()).filter(Boolean);
}
function arrToCsv(arr) { return arr.filter(Boolean).join(","); }

// --- Services ---

export async function getUserByIdService(dbPool, userId) {
    const connection = await dbPool.getConnection();
    try {
        const user = await userRepo.findUserById(connection, userId);
        if (!user) return null;

        user.profilePictureName = user.profilePictureName || null;
        user.dni = user.dni || null;
        user.postcode = user.postcode ? parseInt(user.postcode) : null;
        return user;
    } finally {
        connection.release();
    }
}

export async function getUserSubscriptionsService(dbPool) {
    const connection = await dbPool.getConnection();
    try {
        const rows = await userRepo.findAllSubscriptions(connection);
        return rows.map(sub => {
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
    } finally {
        connection.release();
    }
}

export async function getSubscriptionsHistoryService(dbPool) {
    const connection = await dbPool.getConnection();
    try {
        const rows = await userRepo.findSubscriptionHistory(connection);
        return rows.map(h => {
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
    } finally {
        connection.release();
    }
}

export async function updateUserService(dbPool, { rawUserJson, file, tokenPayload }) {
    if (!rawUserJson) throw { status: 400, message: "Se requiere el campo 'user' en el form-data" };

    const data = JSON.parse(rawUserJson);
    const userId = data.id;
    const email = data.email;

    if (!userId) throw { status: 400, message: "Se requiere el campo 'id' del usuario" };
    if (userId !== tokenPayload.id || email !== tokenPayload.email) {
        throw { status: 401, message: 'No estás autorizado' };
    }

    // Procesar fecha
    if (data.hasOwnProperty('dateOfBirth')) {
        let dateValue = data.dateOfBirth;
        if (dateValue && dateValue.trim() !== '') {
            const parts = dateValue.split('/');
            if (parts.length !== 3) throw { status: 400, message: 'Formato de fecha inválido: esperado DD/MM/YYYY' };

            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            dateValue = `${year}-${month}-${day}`;
            if (isNaN(Date.parse(dateValue))) throw { status: 400, message: 'Fecha inválida' };
        } else {
            dateValue = null;
        }
        data.dateOfBirth = dateValue;
    }

    let connection;
    try {
        connection = await dbPool.getConnection();

        let oldImageName;
        if (file) {
            oldImageName = await userRepo.findProfilePicName(connection, userId);
            data.profilePictureName = file.filename;
        }

        const allowedFields = {
            fullName: 'user_name', email: 'email', phone: 'phone', sex: 'sex',
            dateOfBirth: 'date_of_birth', postcode: 'postal_code', postAddress: 'address',
            dni: 'dni', profilePictureName: 'profile_pic'
        };

        const setClauses = [];
        const values = [];

        for (const [jsonKey, column] of Object.entries(allowedFields)) {
            if (data.hasOwnProperty(jsonKey)) {
                let value = data[jsonKey];
                if ((column === 'sex' || column === 'date_of_birth') && (value === '' || value === null || value === 'NULL')) {
                    setClauses.push(`\`${column}\` = NULL`);
                    continue;
                }
                setClauses.push(`\`${column}\` = ?`);
                values.push(value);
            }
        }

        if (!setClauses.length) throw { status: 400, message: 'No se recibieron campos válidos' };

        setClauses.push('`updated_at` = NOW()');

        await connection.beginTransaction();
        await userRepo.updateUserDynamic(connection, userId, setClauses, values);

        // Obtener usuario actualizado
        const updatedUser = await userRepo.findUserById(connection, userId);
        await connection.commit();

        if (!updatedUser) throw { status: 404, message: 'Usuario no encontrado después de actualización' };

        // Borrar fichero antiguo
        if (file && oldImageName) {
            const oldPath = path.join(UPLOAD_PATH, oldImageName);
            await unlinkAsync(oldPath).catch(err => console.warn(`No se pudo eliminar imagen antigua:`, err));
        }

        // Formatear para retorno
        updatedUser.profilePictureName = updatedUser.profilePictureName || null;
        updatedUser.dni = updatedUser.dni || null;
        updatedUser.postcode = updatedUser.postcode ? parseInt(updatedUser.postcode, 10) : null;

        return updatedUser; // Contiene id y email para el log
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

export async function deleteUserService(dbPool, { rawEmail, tokenEmail }) {
    if (!rawEmail) throw { status: 400, message: "Se requiere el email" };
    if (rawEmail !== tokenEmail) throw { status: 401, message: "No estás autorizado" };

    const email = rawEmail.trim().toLowerCase();
    let connection;

    try {
        connection = await dbPool.getConnection();
        const user = await userRepo.findUserByEmail(connection, email);
        if (!user) throw { status: 404, message: `Usuario '${email}' no encontrado` };

        await connection.beginTransaction();
        const affected = await userRepo.deleteUserByEmail(connection, email);

        if (affected === 0) {
            await connection.rollback();
            throw { status: 404, message: `No se encontró usuario para eliminar` };
        }
        await connection.commit();

        return { userId: user.user_id, email };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

export async function getCoachesService(dbPool) {
    const connection = await dbPool.getConnection();
    try {
        return await userRepo.findAllCoaches(connection);
    } finally {
        connection.release();
    }
}

export async function assignPreferredCoachService(dbPool, { service_name, customer_id, coach_id }) {
    if (!service_name || !customer_id || !coach_id) throw { status: 400, message: 'Faltan campos obligatorios' };

    let connection;
    try {
        connection = await dbPool.getConnection();
        await connection.beginTransaction();

        const service = await userRepo.findServiceByName(connection, service_name);
        if (!service) {
            await connection.rollback();
            throw { status: 400, message: `No existe servicio: "${service_name}"` };
        }

        const existing = await userRepo.findPreferredCoachRelation(connection, customer_id, service.service_id);

        if (existing) {
            await userRepo.updatePreferredCoach(connection, existing.preferred_coach_id, coach_id);
            await connection.commit();
            return { message: 'Actualizado', status: 200 };
        } else {
            await userRepo.createPreferredCoach(connection, service.service_id, customer_id, coach_id);
            await connection.commit();
            return { message: 'Asignado', status: 201 };
        }
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

export async function getPreferredCoachService(dbPool, customerId) {
    if (!customerId) throw { status: 400, message: 'Falta customer_id' };
    const connection = await dbPool.getConnection();
    try {
        const row = await userRepo.findPreferredCoachByCustomer(connection, customerId);
        if (!row) throw { status: 404, message: 'No tienes un profesional favorito asignado.' };
        return { preferred_coach_id: row.coach_id };
    } finally {
        connection.release();
    }
}

export async function getPreferredCoachWithServiceService(dbPool, { customer_id, service_name }) {
    if (!customer_id || !service_name) throw { status: 400, message: 'Faltan parámetros' };
    const connection = await dbPool.getConnection();
    try {
        const service = await userRepo.findPrimaryServiceByName(connection, service_name);
        if (!service) throw { status: 404, message: 'Servicio no encontrado.' };

        const row = await userRepo.findPreferredCoachRelation(connection, customer_id, service.primary_service_id);
        if (!row) throw { status: 404, message: 'No tienes un favorito en este servicio.' };

        return { preferred_coach_id: row.coach_id };
    } finally {
        connection.release();
    }
}

export async function deleteProfilePicService(dbPool, { queryEmail, queryPicName, tokenPayload }) {
    if (!tokenPayload.id) throw { status: 401, message: 'No estás autenticado' };
    if (queryEmail !== tokenPayload.email) throw { status: 401, message: 'No estás autorizado' };

    let connection;
    try {
        connection = await dbPool.getConnection();
        await connection.beginTransaction();

        const oldImageName = await userRepo.findProfilePicName(connection, tokenPayload.id);
        if (!oldImageName) {
            await connection.commit();
            throw { status: 404, message: 'No existe foto de perfil' };
        }

        if (oldImageName !== queryPicName) {
            await connection.commit(); // No rollback needed here really, but cleanup
            throw { status: 404, message: 'El nombre de la foto no coincide' };
        }

        await userRepo.removeUserProfilePic(connection, tokenPayload.id);
        await connection.commit();

        const filePath = join(UPLOAD_PATH, oldImageName);
        await unlinkAsync(filePath).catch(err => console.warn(`Error borrando archivo ${oldImageName}`, err));

        return { userId: tokenPayload.id, email: queryEmail };
    } catch (err) {
        if (connection && connection.rollback) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
}

export async function getUserStatsService(dbPool, userId) {
    if (!userId) throw { status: 400, message: 'Falta user_id' };

    let connection;
    try {
        connection = await dbPool.getConnection();
        const [lastMonth, topCoach, pending] = await Promise.all([
            userRepo.getStatsLastMonth(connection, userId),
            userRepo.getStatsTopCoach(connection, userId),
            userRepo.getStatsPending(connection, userId)
        ]);

        const byService = new Map();
        const upsert = (sid, name) => {
            if (!byService.has(sid)) {
                byService.set(sid, {
                    service_id: sid, service_name: name || '',
                    entrenamientosMesPasado: 0, entrenadorMasUsado: null, reservasPendientes: 0
                });
            }
            return byService.get(sid);
        };

        for (const r of lastMonth) upsert(r.service_id, r.service_name).entrenamientosMesPasado = r.total ?? 0;
        for (const r of topCoach) upsert(r.service_id, r.service_name).entrenadorMasUsado = r.coach_name || null;
        for (const r of pending) upsert(r.service_id, r.service_name).reservasPendientes = r.total ?? 0;

        return Array.from(byService.values());
    } finally {
        if (connection) connection.release();
    }
}

export async function addCouponToUserService(dbPool, { userId, coupon_code, tokenPayload }) {
    if (!coupon_code) throw { status: 400, message: "Se requiere coupon_code" };
    if (!tokenPayload || tokenPayload.id !== userId) throw { status: 401, message: "No estás autenticado." };

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();
        const coupon = await userRepo.findValidCouponByCode(conn, coupon_code);
        if (!coupon) {
            await conn.rollback();
            throw { status: 400, message: "Cupón inválido o expirado" };
        }

        const whitelist = coupon.customer_ids == null ? null : csvToArr(coupon.customer_ids);
        if (whitelist !== null && !whitelist.includes(String(userId))) {
            await conn.rollback();
            throw { status: 403, message: "No tienes permiso para este cupón" };
        }

        const userRow = await userRepo.getUserCouponsIds(conn, userId);
        if (!userRow) {
            await conn.rollback();
            throw { status: 404, message: "Usuario no encontrado" };
        }

        const current = csvToArr(userRow.coupons_ids);
        if (!current.includes(String(coupon.coupon_id))) {
            current.push(String(coupon.coupon_id));
            await userRepo.updateUserCouponsIds(conn, userId, arrToCsv(current));
        }

        await conn.commit();
        return true;
    } catch (err) {
        if (conn) await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

export async function removeCouponToUserService(dbPool, { userId, coupon_code, tokenPayload }) {
    if (!coupon_code) throw { status: 400, message: "Se requiere coupon_code" };
    if (!tokenPayload || tokenPayload.id !== userId) throw { status: 401, message: "No estás autenticado." };

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();
        const coupon = await userRepo.findCouponByCodeSimple(conn, coupon_code);
        if (!coupon) {
            await conn.rollback();
            throw { status: 404, message: "Cupón no encontrado" };
        }

        const userRow = await userRepo.getUserCouponsIds(conn, userId);
        if (!userRow) {
            await conn.rollback();
            throw { status: 404, message: "Usuario no encontrado" };
        }

        const cur = csvToArr(userRow.coupons_ids);
        const next = cur.filter(id => id !== String(coupon.coupon_id));

        if (next.length === cur.length) {
            await conn.rollback();
            throw { status: 400, message: "El usuario no tiene este cupón" };
        }

        await userRepo.updateUserCouponsIds(conn, userId, arrToCsv(next));
        await conn.commit();
        return true;
    } catch (err) {
        if (conn) await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

export async function getUserCouponService(dbPool, { userId, tokenPayload }) {
    if (!tokenPayload || tokenPayload.id !== userId) throw { status: 401, message: "No estás autenticado" };

    const conn = await dbPool.getConnection();
    try {
        const userRow = await userRepo.getUserCouponsIds(conn, userId);
        const idsArr = csvToArr(userRow?.coupons_ids);
        if (idsArr.length === 0) return []; // Retornar vacío si no hay

        const coupons = await userRepo.findCouponsDetails(conn, idsArr, userId);

        return coupons.map(r => ({
            id: r.id,
            code: r.code,
            discount: r.discount,
            isPercentage: Boolean(r.isPercentage),
            startDate: r.startDate,
            expiryDate: r.expiryDate,
            productIds: csvToArr(r.product_ids).map(Number)
        }));
    } finally {
        conn.release();
    }
}

// --- Document Services ---
export async function getUserDocumentsService(dbPool, userId) {
    const conn = await dbPool.getConnection();
    try {
        return await userRepo.findUserDocuments(conn, userId);
    } finally { conn.release(); }
}

export async function uploadUserDocumentService(dbPool, { userId, file }) {
    if (!file) throw { status: 400, message: "No se ha subido ningún archivo" };
    const conn = await dbPool.getConnection();
    try {
        await userRepo.createUserDocument(conn, userId, file.filename, file.originalname);
        return { message: "Documento subido con éxito" };
    } finally { conn.release(); }
}

export async function deleteUserDocumentService(dbPool, { userId, filename }) {
    const conn = await dbPool.getConnection();
    try {
        const doc = await userRepo.findDocumentByFilename(conn, filename, userId);
        if (!doc) throw { status: 404, message: "Documento no encontrado" };

        await userRepo.deleteDocumentRecord(conn, filename, userId);

        // Borrar del disco (asumiendo ruta de documentos)
        const filePath = path.join(process.cwd(), 'uploads', 'users', 'documents', String(userId), filename);
        await fs.promises.unlink(filePath).catch(() => console.warn("Archivo no estaba en disco"));

        return { message: "Documento eliminado" };
    } finally { conn.release(); }
}

// --- E-Wallet Services ---
export async function getEwalletBalanceService(dbPool, userId) {
    const conn = await dbPool.getConnection();
    try {
        const row = await userRepo.findEwalletBalance(conn, userId);
        return { balance: row?.balance || 0 };
    } finally { conn.release(); }
}

export async function getEwalletTransactionsService(dbPool, userId) {
    if (!userId) {
        throw new Error('Falta user_id');
    }

    const conn = await dbPool.getConnection();
    try {
        const rows = await userRepo.findEwalletTransactions(conn, userId);

        return rows.map(tx => ({
            amount: tx.amount,
            balance: tx.balance,
            description: tx.product_name || tx.description || "",
            type: tx.type,
            date: tx.created_at
        }));
    } finally {
        conn.release();
    }
}

export async function checkSavedPaymentMethodService(dbPool, userId) {
    const conn = await dbPool.getConnection();
    try {
        const method = await userRepo.findSavedPaymentMethod(conn, userId);
        return { hasSavedMethod: !!method };
    } finally { conn.release(); }
}