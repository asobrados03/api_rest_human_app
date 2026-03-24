import request from 'supertest';
import { jest } from '@jest/globals';

const mockReserveSessionService = jest.fn();

jest.unstable_mockModule('../../middlewares/verifyToken.js', () => ({
  verifyToken: (req, _res, next) => {
    req.user_payload = { id: 33 };
    next();
  }
}));

jest.unstable_mockModule('../../services/product-booking.service.js', () => ({
  reserveSessionService: mockReserveSessionService,
  getDailyAvailabilityService: jest.fn(),
  updateBookingService: jest.fn(),
  getUserBookingsService: jest.fn(),
  cancelBookingService: jest.fn(),
  getUserProductService: jest.fn(),
  getTimeslotIdService: jest.fn(),
  getProductMappingService: jest.fn(),
  getUpcomingHolidays: jest.fn()
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
}));

const { default: app } = await import('../../app.js');

describe('Integración - Product Booking API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/mobile/bookings -> 201 cuando la reserva es exitosa', async () => {
    mockReserveSessionService.mockResolvedValue({ booking_id: 901 });

    const payload = {
      customer_id: 5,
      coach_id: 2,
      session_timeslot_id: 11,
      service_id: 4,
      product_id: 8,
      start_date: '2026-04-01'
    };

    const response = await request(app)
      .post('/api/mobile/bookings')
      .set('Authorization', 'Bearer fake-token')
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      message: 'Reserva creada con éxito',
      booking_id: 901
    });
  });

  it('POST /api/mobile/bookings -> 400 por error de validación', async () => {
    const response = await request(app)
      .post('/api/mobile/bookings')
      .set('Authorization', 'Bearer fake-token')
      .send({ customer_id: 5 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Faltan campos obligatorios' });
    expect(mockReserveSessionService).not.toHaveBeenCalled();
  });

  it('POST /api/mobile/bookings -> 500 por error inesperado', async () => {
    mockReserveSessionService.mockRejectedValue(new Error('Booking service unavailable'));

    const response = await request(app)
      .post('/api/mobile/bookings')
      .set('Authorization', 'Bearer fake-token')
      .send({
        customer_id: 5,
        coach_id: 2,
        session_timeslot_id: 11,
        service_id: 4,
        product_id: 8,
        start_date: '2026-04-01'
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Error al insertar la reserva',
      details: 'Booking service unavailable'
    });
  });
});
