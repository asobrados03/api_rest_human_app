import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import * as controller from '../controllers/service-products.controller.js'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/', controller.testMobileRoute)
router.get('/services', verifyToken, controller.getAllServices)
router.get('/service-products', verifyToken, controller.getServiceProducts)
router.get('/users/:userId/products', verifyToken, (req, _res, next) => {
    req.query.user_id = req.params.userId
    next()
}, controller.getUserProducts)
router.post('/users/:userId/products', verifyToken, controller.assignProductToUser)
router.delete('/users/:userId/products/:productId', verifyToken, controller.unassignProductFromUser)
router.get('/active-product-detail', verifyToken, controller.getActiveProductDetail)
router.get('/products/:id', verifyToken, controller.getProductDetailForHireProduct);

export default router
