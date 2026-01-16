import multer from 'multer'
import path from 'path'
import fs from 'fs-extra'

export const UPLOAD_DOC_PATH = process.env.NODE_ENV === 'production'
    ? '/var/uploads/human-app/document'
    : path.join(process.cwd(), 'pictures', 'document');

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            // ⚙️ Si viene un "customer_id" en el body, usarlo como destino
            const userId = req.body?.customer_id || req.user_payload.id;
            const dir = path.join(UPLOAD_DOC_PATH, String(userId));
            await fs.ensureDir(dir);
            cb(null, dir);
        } catch (err) {
            cb(err);
        }
    },

    filename: (req, file, cb) => {
        const ext    = path.extname(file.originalname)
        const base   = path.basename(file.originalname, ext)
        const unique = `${base}-${Date.now()}${ext}`
        cb(null, unique)
    }
})

const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]

    const allowedExts = ['.pdf', '.png', '.jpeg', '.jpg', '.doc', '.docx']
    const fileExt = path.extname(file.originalname).toLowerCase()

    if (allowedMimes.includes(file.mimetype) && allowedExts.includes(fileExt)) {
        cb(null, true)
    } else {
        cb(new Error(`Tipo de archivo no soportado. Permitidos: ${allowedExts.join(', ')}`), false)
    }
}

const uploadMobileDocument = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 1 // Solo un archivo por request
    }
})

export default uploadMobileDocument