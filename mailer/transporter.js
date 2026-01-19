import { google } from 'googleapis';
import 'dotenv/config';

const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
);

oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// Usamos la versión v1 de la Gmail API
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Exportamos un objeto que imite el comportamiento de enviar, pero por HTTPS
export const gmailTransporter = {
    sendMail: async (options) => {
        // Construcción del mensaje en formato MIME
        const subject = options.subject;
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

        const messageParts = [
            `From: ${options.from}`,
            `To: ${options.to}`,
            'Content-Type: text/plain; charset=utf-8',
            'MIME-Version: 1.0',
            `Subject: ${utf8Subject}`,
            '',
            options.text
        ];

        const message = messageParts.join('\n');

        // Codificar en Base64 URL Safe para la API de Google
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        return gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });
    }
};