import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import * as controller from '../controllers/service-products.controller.js'

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
router.get('/user-products', verifyToken, ...withDeprecation('/api/mobile/users/:userId/products', controller.getUserProducts))
router.get('/user-product', verifyToken, ...withDeprecation('/api/mobile/users/:userId/products', controller.getUserProducts))
router.post('/users/:userId/products', verifyToken, controller.assignProductToUser)
router.delete('/users/:userId/products/:productId', verifyToken, controller.unassignProductFromUser)
router.get('/active-product-detail', verifyToken, controller.getActiveProductDetail)
router.get('/products/:id', verifyToken, controller.getProductDetailForHireProduct);

export default router