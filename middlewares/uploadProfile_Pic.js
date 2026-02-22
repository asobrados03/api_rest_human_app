import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';

import logger from '../utils/pino.js';
export const UPLOAD_PATH = process.env.NODE_ENV === 'production'
    ? '/var/uploads/human-app/profile_pic'
    : path.join(process.cwd(), 'pictures', 'profile_pic');

logger.info('📁 UPLOAD_PATH configurado:', UPLOAD_PATH);

// Configuración del almacenamiento SIN renombrar el archivo
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); // se mantiene el nombre original
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten imágenes JPG, JPEG o PNG'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {fileSize: 10 * 1024 * 1024} // 10MB máximo permitido
});

// Middleware adicional para comprimir si supera 1MB
export default upload;
export const compressImageIfNeeded = async (req, res, next) => {
    logger.info("🧩 Entrando al middleware de compresión");
    logger.info("📂 Ruta de subida:", UPLOAD_PATH);
    if (!req.file) {
        logger.info("❌ No se recibió ningún archivo en req.file");
        return next();
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const filePath = path.resolve(UPLOAD_PATH, req.file.filename);

    try {
        const originalStats = await fs.stat(filePath);
        const originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);

        logger.info(`📸 Imagen recibida: ${req.file.originalname}`);
        logger.info(`📦 Tamaño original: ${originalStats.size} bytes (${originalSizeMB} MB)`);

        if (originalStats.size <= 1024 * 1024) {
            logger.info('🟢 No se necesita compresión (tamaño ≤ 1MB)');
            return next();
        }

        let buffer;

        if (ext === '.png') {
            buffer = await sharp(filePath)
                .png({ compressionLevel: 9 })
                .toBuffer();
        } else if (ext === '.jpg' || ext === '.jpeg') {
            const image = sharp(filePath);
            // Opcional: reducir resolución si la imagen es muy grande
            const metadata = await image.metadata();
            if (metadata.width > 1920) {
                image.resize({ width: 1920 }); // redimensiona a máximo 1920px ancho
            }

            buffer = await image
                .jpeg({
                    quality: 70,
                    mozjpeg: true, // compresión más eficiente
                })
                .toBuffer();
        }

        if (buffer) {
            await fs.writeFile(filePath, buffer);
            const compressedStats = await fs.stat(filePath);
            const compressedSizeMB = (compressedStats.size / (1024 * 1024)).toFixed(2);

            logger.info(`✅ Imagen comprimida exitosamente`);
            logger.info(`🔻 Tamaño después: ${compressedStats.size} bytes (${compressedSizeMB} MB)`);
        }

        next();

    } catch (err) {
        logger.error('❌ Error al comprimir imagen:', err);
        return res.status(500).json({ error: 'Error al comprimir imagen' });
    }
};

export function handleProfilePicUpload(req, res, next) {
    upload.single("profile_pic")(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res
                .status(413)
                .json({ error: "El archivo es demasiado grande. Máximo 10 MB." });
        } else if (err) {
            logger.error("❌ Error al subir imagen:", err);
            return res.status(400).json({ error: "Error al subir la imagen" });
        }
        next();
    });
}