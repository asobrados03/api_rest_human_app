import { Router } from 'express'
import * as authController from '../controllers/auth.controller.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import upload, { compressImageIfNeeded } from '../middlewares/uploadProfile_Pic.js'

const router = Router()

// Inyectar pool de conexión a la request para que el Controller lo pueda usar
router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

// Rutas de autenticación modeladas como recursos
router.post('/users', upload.single('profile_pic'), compressImageIfNeeded, authController.registerUser)
router.post('/sessions', authController.loginUser)
router.delete('/sessions/current', verifyToken, authController.logoutCurrentSession)
router.post('/tokens/refresh', authController.refreshTokenController)
router.put('/change-password', verifyToken, authController.changePassword)
router.put('/reset-password', authController.resetPassword)

export default router
