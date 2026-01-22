/**
 * Busca un usuario por su email.
 */
export async function findUserByEmail(connection, email) {
    const [rows] = await connection.execute(
        'SELECT * FROM users WHERE email = ?',
        [email]
    );
    return rows[0]; // Retorna undefined si no existe
}

/**
 * Busca si existe un usuario por DNI y devuelve su email.
 */
export async function findUserByDni(connection, dni) {
    const [rows] = await connection.execute(
        'SELECT email FROM users WHERE dni = ?',
        [dni]
    );
    return rows[0];
}

/**
 * Busca un usuario por ID.
 */
export async function findUserById(connection, userId) {
    const [rows] = await connection.execute(
        'SELECT * FROM users WHERE user_id = ?',
        [userId]
    );
    return rows[0];
}

/**
 * Inserta un nuevo usuario.
 */
export async function createUser(connection, data) {
    const {
        nombreCompleto, email, hashedPassword, telefono, sexo,
        fechaSql, codigoPostal, dni, direccionPostal, profilePicFilename, deviceType
    } = data;

    const [result] = await connection.execute(
        `INSERT INTO users
        (user_name, email, password, phone, sex, date_of_birth, postal_code, dni, address, profile_pic, device_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [nombreCompleto, email, hashedPassword, telefono, sexo,
            fechaSql, codigoPostal, dni, direccionPostal, profilePicFilename, deviceType]
    );
    return result.insertId;
}

/**
 * Actualiza datos básicos del usuario (DNI, Dirección).
 */
export async function updateUserPayInfo(connection, userId, updates, values) {
    // updates es un array tipo ['dni = ?', 'address = ?']
    // values son los valores correspondientes
    await connection.execute(
        `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
        [...values, userId]
    );
}

/**
 * Actualiza la contraseña de un usuario.
 */
export async function updateUserPassword(connection, userId, newHash) {
    await connection.execute(
        'UPDATE users SET password = ? WHERE user_id = ?',
        [newHash, userId]
    );
}

/**
 * Actualiza la contraseña buscando por email (Reset Password).
 */
export async function updatePasswordByEmail(connection, email, newHash) {
    const [result] = await connection.execute(
        'UPDATE users SET password = ? WHERE email = ?',
        [newHash, email]
    );
    return result.affectedRows > 0;
}