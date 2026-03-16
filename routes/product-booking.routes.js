import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import * as productBookingController from '../controllers/product-booking.controller.js'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/', productBookingController.testMobileRoute)
router.get('/daily', verifyToken, productBookingController.getDailyAvailability)
router.post('/bookings', verifyToken, productBookingController.reserveSession)
router.get('/user-product', verifyToken, productBookingController.getUserProduct)
router.get('/timeslot-id', verifyToken, productBookingController.getTimeslotId)
router.get('/product/:productId/service-info', verifyToken, productBookingController.getServiceIdForProduct)
router.get('/user-bookings', verifyToken, productBookingController.getUserBookings)
router.delete('/bookings/:bookingId',verifyToken, productBookingController.cancelBooking)
router.patch('/bookings/:id', verifyToken, productBookingController.updateBooking)
router.get('/holidays', verifyToken, productBookingController.getHolidays)

export default router
