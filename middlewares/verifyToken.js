import jwt from 'jsonwebtoken'
import { SECRET_JWT_KEY } from '../config.js'

export function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null

    if (!token) {
        return res
            .status(401)
            .set(
                'WWW-Authenticate',
                'Bearer realm="HumanPerform", charset="UTF-8"'
            )
            .json({ error: 'Token not provided' })
    }

    try {
        req.user_payload = jwt.verify(token, SECRET_JWT_KEY)
        next()
    } catch (err) {
        console.error('🔒 verifyToken failed:', err.message)
        return res
            .status(401)
            .set(
                'WWW-Authenticate',
                'Bearer realm="HumanPerform", charset="UTF-8"'
            )
            .json({ error: 'Token not valid' })
    }
}