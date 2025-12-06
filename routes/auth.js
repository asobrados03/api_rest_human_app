import { Router } from 'express'
import { registerUser, loginUser, refreshTokenController, resetPassword, changePassword, updateUserPayInfo} from '../controllers/auth.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import upload, { compressImageIfNeeded } from '../middlewares/uploadProfile_Pic.js'

const router = Router()

// Inyectar pool de conexión
router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})


router.post('/register', upload.single('profile_pic'), compressImageIfNeeded, registerUser)
router.post('/login', loginUser)
router.post('/refresh', refreshTokenController)
router.put('/change-password', verifyToken, changePassword)
router.put('/reset-password', resetPassword)
router.put('/update-pay-info', verifyToken, updateUserPayInfo)

export default router