import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import * as controller from '../controllers/user.controller.js'
import logger from '../utils/pino.js';
import { compressImageIfNeeded, handleProfilePicUpload } from "../middlewares/uploadProfile_Pic.js"
import uploadMobileDocument from '../middlewares/uploadDocument.js'
import path from 'path'
import fs from 'fs'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/user', verifyToken, controller.getUser)
router.put('/user', verifyToken, handleProfilePicUpload, compressImageIfNeeded, controller.updateUser)
router.delete('/user', verifyToken, controller.deleteUser)
router.delete('/user/photo', verifyToken, controller.deleteProfilePic)

router.get('/users/:userId/stats', verifyToken, controller.getUserStats)

router.get('/coaches', verifyToken, controller.getCoaches)
router.post('/user/preferred-coach', verifyToken, controller.assignPreferredCoach)
router.get('/user/preferred-coach', verifyToken, controller.getPreferredCoach)
router.get('/user/preferred-coach-with-service', verifyToken, controller.getPreferredCoachWithService)

router.post('/users/:userId/coupons', verifyToken, controller.addCouponToUser)
router.delete('/users/:userId/coupons/:couponCode', verifyToken, controller.removeCouponToUser)
router.get('/users/:userId/coupons', verifyToken, controller.getUserCoupon)

router.post('/users/:userId/documents', verifyToken, uploadMobileDocument.single('file'), controller.uploadUserDocument)
router.get('/users/:userId/documents', verifyToken, controller.getUserDocuments)
router.delete('/users/:userId/documents/:filename', verifyToken, controller.deleteUserDocument)
router.get('/users/:userId/documents/:filename', verifyToken, async (req, res) => {
    try {
        const userId = req.user_payload.id
        const filename = req.params.filename
        const filePath = path.join(process.cwd(), 'uploads', 'users', 'documents', String(userId), filename)

        await fs.promises.access(filePath)

        return res.download(filePath, (err) => {
            if (err) {
                logger.error({ err }, 'Error al descargar archivo:')
                if (err.code === 'ENOENT') {
                    return res.status(404).json({ error: 'Documento no encontrado' })
                }
                return res.status(500).json({ error: 'Error al descargar el documento' })
            }
        })
    } catch (err) {
        logger.error({ err }, 'Error al acceder al documento:')
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Documento no encontrado' })
        }
        return res.status(500).json({ error: 'Error de infraestructura al acceder al documento' })
    }
})

// --- E-Wallet & Suscripciones ---
router.get('/user/e-wallet-balance', verifyToken, controller.getEwalletBalance)
router.get('/user/transactions', verifyToken, controller.getEwalletTransactions)
router.get('/user/saved-payment-method', verifyToken, controller.checkSavedPaymentMethod)
router.get('/user/subscriptions', verifyToken, controller.getUserSubscriptions)
router.get('/user/subscriptions/history', verifyToken, controller.getSubscriptionsHistory)

export default router
