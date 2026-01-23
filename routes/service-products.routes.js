import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import {testMobileRoute, getAllServices, getServiceProducts, getUserProducts, assignProductToUser,
    unassignProductFromUser, getProductDetails, applyCoupon,
    searchProducts} from '../controllers/service-products.controller.js'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/', testMobileRoute)
router.get('/services', /*verifyToken,*/ getAllServices)
router.get('/service-products', /*verifyToken,*/ getServiceProducts)
router.get('/user-products', verifyToken, getUserProducts)
router.post('/assign-product', assignProductToUser)
router.delete('/unassign-product', verifyToken, unassignProductFromUser)
router.get('/product-details', verifyToken, getProductDetails)
router.post('/apply-coupon', verifyToken, applyCoupon);
router.get('/products-search', /*verifyToken,*/ searchProducts);

export default router