import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

console.log("📂 Directorio actual:", process.cwd());

export const {
    // NO HARDCODED ESTA KEY DEBE SER LARGA Y MUY SEGURA
    SECRET_JWT_KEY = '0837e25147c8582f39ce55ce9dd6aac9ec7e41a1d70d6bc878f51cdf3724914c353d7f78fb67b6f5',
    // EN PRODUCCIÓN SE PONDRÁ COMO VARIABLE DE ENTORNO
    ADDON_ID,
    ADDON_SECRET,
    MERCHANT_ID,
    SECRET,
    MERCHANT_ID_S,
    SECRET_S,
    MAIL_USERNAME,
    MAIL_APP_PASSWORD,
    JWT_SECRET
} = process.env