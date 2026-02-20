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
router.get('/user-products', verifyToken, controller.getUserProducts)
router.post('/assign-product', verifyToken, controller.assignProductToUser)
router.delete('/unassign-product', verifyToken, controller.unassignProductFromUser)
router.get('/active-product-detail', verifyToken, controller.getActiveProductDetail)
router.get('/products-search', /*verifyToken,*/ controller.searchProducts);
router.get('/products/:id', verifyToken, controller.getProductDetailForHireProduct);

export default router