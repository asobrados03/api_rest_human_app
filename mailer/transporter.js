import nodemailer from 'nodemailer'
import 'dotenv/config'

export const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        type: 'OAuth2', // Define que usaremos OAuth2
        user: process.env.GMAIL_FROM, // Tu correo (tu-cuenta@gmail.com)
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN
        // accessToken: no es necesario ponerlo aquí, Nodemailer generará uno nuevo usando el refreshToken automáticamente
    }
})

// Verificar la configuración al inicializar
transporter.verify(function(error) {
    if (error) {
        console.log('Error en configuración de email:', error);
    } else {
        console.log('Servidor de email listo para enviar mensajes vía Gmail API');
    }
})