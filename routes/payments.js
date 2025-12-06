import { Router } from 'express';
const router = Router();
import { verifyToken } from '../middlewares/verifyToken.js';
import {initiatePayment, confirmPayment, paymentResultRedirect} from '../controllers/payments.js';

router.post('/initiate',verifyToken, initiatePayment);
router.post('/status', verifyToken, confirmPayment); // statusURL (server-to-server)
router.get('/result', verifyToken, paymentResultRedirect); // redirect URL


router.get('/', async (req, res) => {
    res.json({ message: 'Ruta activa para el bloque: set-up' });
});

export default router;