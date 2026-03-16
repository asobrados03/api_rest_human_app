import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import {
    getUser,
    updateUser,
    deleteUser,
    getCoaches,
    assignPreferredCoach,
    getPreferredCoach,
    getPreferredCoachWithService,
    getUserStats,
    deleteProfilePic,
    addCouponToUser,
    getUserCoupon,
    uploadUserDocument,
    deleteUserDocument,
    getUserDocuments,
    getEwalletBalance,
    getEwalletTransactions,
    checkSavedPaymentMethod,
    removeCouponToUser,
    getUserSubscriptions,
    getSubscriptionsHistory
} from '../controllers/user.controller.js'
import logger from '../utils/pino.js';
import { compressImageIfNeeded, handleProfilePicUpload } from "../middlewares/uploadProfile_Pic.js"
import uploadMobileDocument from '../middlewares/uploadDocument.js'
import path from 'path'
import fs from 'fs'

const router = Router()

const DEPRECATION_SUNSET_DATE = 'Wed, 30 Sep 2026 23:59:59 GMT'

const withDeprecation = (replacementPath, handler) => [
    (req, res, next) => {
        res.setHeader('Deprecation', 'true')
        res.setHeader('Sunset', DEPRECATION_SUNSET_DATE)
        res.setHeader('Warning', `299 - "Deprecated API route. Use ${replacementPath}"`)
        res.setHeader('Link', `<${replacementPath}>; rel="successor-version"`)
        next()
    },
    handler
]

const resolveUserContextFromPath = (req, _res, next) => {
    req.query.user_id = req.params.userId
    next()
}

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/user', verifyToken, getUser)
router.put('/user', verifyToken, handleProfilePicUpload, compressImageIfNeeded, updateUser)
router.delete('/user', verifyToken, deleteUser)
router.delete('/user/photo', verifyToken, deleteProfilePic)

router.get('/users/:userId/stats', verifyToken, resolveUserContextFromPath, getUserStats)
router.get('/user-stats', verifyToken,
    ...withDeprecation('/api/mobile/users/:userId/stats', (req, _res, next) => {
        req.query.user_id = req.query.user_id || req.user_payload?.id
        next()
    }),
    getUserStats
)

router.get('/coaches', verifyToken, getCoaches)
router.get('/list_coaches', verifyToken, ...withDeprecation('/api/mobile/coaches', getCoaches))
router.post('/user/preferred-coach', verifyToken, assignPreferredCoach)
router.get('/user/preferred-coach', verifyToken, getPreferredCoach)
router.get('/user/preferred-coach-with-service', verifyToken, getPreferredCoachWithService)

router.post('/users/:userId/coupons', verifyToken, addCouponToUser)
router.post('/users/:userId/coupon', verifyToken, ...withDeprecation('/api/mobile/users/:userId/coupons', addCouponToUser))
router.delete('/users/:userId/coupons/:couponCode', verifyToken, removeCouponToUser)
router.get('/users/:userId/coupons', verifyToken, getUserCoupon)
router.get('/users/:userId/coupon', verifyToken, ...withDeprecation('/api/mobile/users/:userId/coupons', getUserCoupon))

router.post('/users/:userId/documents', verifyToken, uploadMobileDocument.single('file'), uploadUserDocument)
router.get('/users/:userId/documents', verifyToken, getUserDocuments)
router.delete('/users/:userId/documents/:filename', verifyToken, deleteUserDocument)
router.get('/users/:userId/documents/:filename', verifyToken, async (req, res) => {
    try {
        const userId = req.user_payload.id
        const filename = req.params.filename
        const filePath = path.join(process.cwd(), 'uploads', 'users', 'documents', String(userId), filename)

        await fs.promises.access(filePath)

        return res.download(filePath, (err) => {
            if (err) {
                logger.error({ err }, 'Error al descargar archivo:')
                return res.status(404).json({ error: 'Error al descargar el documento' })
            }
        })
    } catch (err) {
        logger.error({ err }, 'Error al acceder al documento:')
        return res.status(404).json({ error: 'Documento no encontrado' })
    }
})

router.post('/user/document', verifyToken, ...withDeprecation('/api/mobile/users/:userId/documents', uploadMobileDocument.single('file')), uploadUserDocument)
router.get('/user/documents', verifyToken, ...withDeprecation('/api/mobile/users/:userId/documents', getUserDocuments))
router.delete('/user/document/:filename', verifyToken, ...withDeprecation('/api/mobile/users/:userId/documents/:filename', deleteUserDocument))
router.get('/user/document/:filename', verifyToken, ...withDeprecation('/api/mobile/users/:userId/documents/:filename', async (req, res) => {
    try {
        const userId = req.user_payload.id
        const filename = req.params.filename
        const filePath = path.join(process.cwd(), 'uploads', 'users', 'documents', String(userId), filename)

        await fs.promises.access(filePath)

        return res.download(filePath, (err) => {
            if (err) {
                logger.error({ err }, 'Error al descargar archivo:')
                return res.status(404).json({ error: 'Error al descargar el documento' })
            }
        })
    } catch (err) {
        logger.error({ err }, 'Error al acceder al documento:')
        return res.status(404).json({ error: 'Documento no encontrado' })
    }
}))

// --- E-Wallet & Suscripciones ---
router.get('/user/e-wallet-balance', verifyToken, getEwalletBalance)
router.get('/user/transactions', verifyToken, getEwalletTransactions)
router.get('/user/saved-payment-method', verifyToken, checkSavedPaymentMethod)
router.get('/user/subscriptions', verifyToken, getUserSubscriptions)
router.get('/user/subscriptions/history', verifyToken, getSubscriptionsHistory)

export default router
