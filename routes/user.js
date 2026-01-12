import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import { getUser, updateUser, deleteUser, getCoaches, assignPreferredCoach, getPreferredCoach,
    getPreferredCoachWithService, getUserStats, deleteProfilePic, addCouponToUser, getUserCoupon, uploadUserDocument,
    deleteUserDocument, getUserDocuments, getEwalletBalance, getEwalletTransactions, checkSavedPaymentMethod,
    removeCouponToUser, getUserSubscriptions, uploadCustomerDocument, searchUsers, getSubscriptionsHistory,
    getUserTourFlag, setUserTourFlag } from '../controllers/user.js'
import {compressImageIfNeeded, handleProfilePicUpload} from "../middlewares/uploadProfile_Pic.js"
import uploadMobileDocument from '../middlewares/uploadDocument.js'
import path from 'path'
import fs from 'fs'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/user', verifyToken, getUser);
router.put('/user', verifyToken, handleProfilePicUpload, compressImageIfNeeded, updateUser)
router.post('/user', verifyToken, deleteUser)
router.get('/list_coaches', verifyToken, getCoaches)
router.post('/user/preferred-coach', verifyToken, assignPreferredCoach)
router.get('/user/preferred-coach', verifyToken, getPreferredCoach)
router.get('/user/preferred-coach-with-service', verifyToken, getPreferredCoachWithService)
router.delete('/user/photo', verifyToken, deleteProfilePic)
router.get('/user-stats', verifyToken, getUserStats)
router.post('/user/:userId/upload-customer-document', verifyToken, uploadMobileDocument.single('file'), uploadCustomerDocument); // ✅ nuevo endpoint
router.post('/user/:userId/coupon', verifyToken, addCouponToUser)
router.post('/user/:userId/coupon/remove', verifyToken, removeCouponToUser)
router.get('/user/:userId/coupon', verifyToken, getUserCoupon)
router.post('/user/document', verifyToken, uploadMobileDocument.single('file'), uploadUserDocument)
router.get('/user/documents', verifyToken, getUserDocuments)
router.get('/user/document/:filename', verifyToken, async (req, res) => {
    try {
        const userId = req.user_payload.id
        const filename = req.params.filename
        const filePath = path.join(process.cwd(), 'uploads', 'users', 'documents', String(userId), filename)

        // Verificar que el archivo existe
        await fs.promises.access(filePath)

        // Descargar el archivo
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
router.delete('/user/document/:filename', verifyToken, deleteUserDocument)
router.get('/user/e-wallet-balance'/*, verifyToken*/, getEwalletBalance)
router.get('/user/transactions'/*, verifyToken*/, getEwalletTransactions);
router.get('/user/saved-payment-method'/*, verifyToken*/, checkSavedPaymentMethod);
router.get('/user/subscriptions'/*, verifyToken*/, getUserSubscriptions);
router.get('/user/tour', verifyToken, getUserTourFlag);
router.put('/user/tour', verifyToken, setUserTourFlag);
router.get('/user/search', searchUsers);
router.get('/user/subscriptions/history'/*, verifyToken*/, getSubscriptionsHistory);

export default router