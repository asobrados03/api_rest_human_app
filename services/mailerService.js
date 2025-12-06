import { transporter } from '../mailer/transporter.js';

export async function sendResetEmail(email, plainPassword) {
    const mailOptions = {
        from: `"Soporte de Human Perform Center" <${process.env.MAIL_USERNAME}>`, // Corregido: usar backticks
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
        const info = await transporter.sendMail(mailOptions);
        console.log('Email enviado exitosamente:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error enviando email:', error);
        throw error;
    }
}
