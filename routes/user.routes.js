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
import { compressImageIfNeeded, handleProfilePicUpload } from "../middlewares/uploadProfile_Pic.js"
import uploadMobileDocument from '../middlewares/uploadDocument.js'
import path from 'path'
import fs from 'fs'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/user', verifyToken, getUser)
router.put('/user', verifyToken, handleProfilePicUpload, compressImageIfNeeded, updateUser)
router.delete('/user', verifyToken, deleteUser)
router.delete('/user/photo', verifyToken, deleteProfilePic)
router.get('/user-stats', verifyToken, getUserStats)

router.get('/list_coaches', verifyToken, getCoaches)
router.post('/user/preferred-coach', verifyToken, assignPreferredCoach)
router.get('/user/preferred-coach', verifyToken, getPreferredCoach)
router.get('/user/preferred-coach-with-service', verifyToken, getPreferredCoachWithService)

router.post('/user/:userId/coupon', verifyToken, addCouponToUser)
router.post('/user/:userId/coupon/remove', verifyToken, removeCouponToUser)
router.get('/user/:userId/coupon', verifyToken, getUserCoupon)

router.post('/user/document', verifyToken, uploadMobileDocument.single('file'), uploadUserDocument)
router.get('/user/documents', verifyToken, getUserDocuments)
router.delete('/user/document/:filename', verifyToken, deleteUserDocument)

// Endpoint de descarga (Lógica de servidor de archivos)
router.get('/user/document/:filename', verifyToken, async (req, res) => {
    try {
        const userId = req.user_payload.id
        const filename = req.params.filename
        const filePath = path.join(process.cwd(), 'uploads', 'users', 'documents', String(userId), filename)

        await fs.promises.access(filePath)

        return res.download(filePath, (err) => {
            if (err) {
                console.error('Error al descargar archivo:', err)
                return res.status(404).json({ error: 'Error al descargar el documento' })
            }
        })
    } catch (err) {
        console.error('Error al acceder al documento:', err)
        return res.status(404).json({ error: 'Documento no encontrado' })
    }
})

// --- E-Wallet & Suscripciones ---
router.get('/user/e-wallet-balance', getEwalletBalance)
router.get('/user/transactions', getEwalletTransactions)
router.get('/user/saved-payment-method', checkSavedPaymentMethod)
router.get('/user/subscriptions', getUserSubscriptions)
router.get('/user/subscriptions/history', getSubscriptionsHistory)

export default router