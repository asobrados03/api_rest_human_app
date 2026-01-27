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
router.post('/reserve', verifyToken, productBookingController.reserveSession)
router.get('/user-product', verifyToken, productBookingController.getUserProduct)
router.get('/timeslot-id', verifyToken, productBookingController.getTimeslotId)
router.get('/preferred-coach', verifyToken, productBookingController.getPreferredCoach)
router.get('/product/:productId/service-info', verifyToken, productBookingController.getServiceIdForProduct)
router.get('/user-services', verifyToken, productBookingController.getUserServices)
router.get('/user-bookings', verifyToken, productBookingController.getUserBookings)
router.delete('/booking/:id',verifyToken, productBookingController.cancelBooking)
router.put('/update-booking', verifyToken, productBookingController.updateBooking)
router.get('/user-weekly-limit', verifyToken, productBookingController.getUserWeeklyLimit)
router.get('/holidays', verifyToken, productBookingController.getHolidays)
router.get('/user-training-bookings', verifyToken, productBookingController.getUserTrainingBookings);
router.get('/trainer/reservations/slots', verifyToken, productBookingController.getTrainerReservationSlots)
router.post('/recover-session', verifyToken, productBookingController.recoverSession)

export default router