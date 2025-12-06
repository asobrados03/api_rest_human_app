import { Router } from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import { testMobileRoute, getDailyAvailability, reserveSession, getUserProduct, getUserTrainingBookings,
    getTimeslotId, getPreferredCoach, getUserServices, getUserBookings, cancelBooking, updateBooking, getUserWeeklyLimit, getHolidays, submitBookingQuestionnaire, getBookingQuestionnaireStatus, getTrainerReservationSlots, recoverSession } from '../controllers/prod-and-reserve.js'

const router = Router()

router.use((req, res, next) => {
    req.db = req.app.get('db')
    next()
})

router.get('/', testMobileRoute)
router.get('/daily', verifyToken, getDailyAvailability)
router.post('/reserve', verifyToken, reserveSession)
router.get('/user-product', verifyToken, getUserProduct)
router.get('/timeslot-id', verifyToken, getTimeslotId)
router.get('/preferred-coach', verifyToken, getPreferredCoach)
router.get('/user-services', verifyToken, getUserServices)
router.get('/user-bookings', verifyToken, getUserBookings)
router.delete('/booking/:id'/*,verifyToken*/, cancelBooking)
router.put('/update-booking', verifyToken, updateBooking)
router.get('/user-weekly-limit', verifyToken, getUserWeeklyLimit)
router.get('/holidays', verifyToken, getHolidays)
router.post('/booking-questionnaire', verifyToken, submitBookingQuestionnaire)
router.get('/booking-questionnaire/:booking_id', verifyToken, getBookingQuestionnaireStatus)
router.get('/user-training-bookings', verifyToken, getUserTrainingBookings);
router.get('/trainer/reservations/slots', verifyToken, getTrainerReservationSlots)
router.post('/recover-session', verifyToken, recoverSession)

export default router