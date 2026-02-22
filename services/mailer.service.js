import { gmailTransporter } from '../utils/transporter.js';

import logger from '../utils/pino.js';
export async function sendResetEmail(email, plainPassword) {
    const mailOptions = {
        from: `"Soporte de Human Perform Center" <${process.env.GMAIL_FROM}>`,
        to: email,
        subject: 'Restablecimiento de contraseña',
        text: `
¡Hola!

Tu contraseña ha sido restablecida. Tu nueva contraseña es:

    ${plainPassword}

Por favor, inicia sesión y cámbiala por una que tú elijas cuanto antes.

Saludos,
Equipo de Human Perform App
        `.trim()
    };

    try {
        // Esto ahora viaja por HTTPS (Puerto 443)
        const info = await gmailTransporter.sendMail(mailOptions);
        logger.info('📧 Email enviado vía Gmail API (HTTPS) exitosamente:', info.data.id);
        return info;
    } catch (error) {
        logger.error('❌ Error enviando email vía API:', error.message);
        throw error;
    }
}
