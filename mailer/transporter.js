import nodemailer from 'nodemailer'
import 'dotenv/config'

export const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_APP_PASSWORD
    }
})

// Verificar la configuración al inicializar
transporter.verify(function(error) {
    if (error) {
        console.log('Error en configuración de email:', error);
    } else {
        console.log('Servidor de email listo para enviar mensajes');
    }
})
