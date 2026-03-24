import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createMockConnection,
  createVerifyTokenModule,
  resetMockObject,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const bookingRepository = {
  getServiceMappingByProduct: jest.fn(),
  fetchTimeslots: jest.fn(),
  fetchCoaches: jest.fn(),
  fetchBookings: jest.fn(),
  fetchAvailability: jest.fn(),
  findExistingBooking: jest.fn(),
  findActiveProduct: jest.fn(),
  countWeeklyBookings: jest.fn(),
  countTotalBookings: jest.fn(),
  insertBooking: jest.fn(),
  bookingExists: jest.fn(),
  updateBookingRow: jest.fn(),
  fetchUserBookings: jest.fn(),
  cancelBookingRow: jest.fn(),
  findTimeslotByHour: jest.fn(),
  findUpcomingHolidays: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule({ id: 1, role: 'user' }));
jest.unstable_mockModule('../../repositories/product-booking.repository.js', () => bookingRepository);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Product Booking API completa', () => {
  // Cubre reglas de reservas del servicio (duplicados, límites por producto y transformaciones de salida).
  let connection;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockObject(bookingRepository);
    connection = createMockConnection();
    setupDbConnectionMock(mockGetConnection, connection);
  });

  it('GET /api/mobile/ -> 200', async () => {
    const res = await request(app).get('/api/mobile/');
    expect(res.status).toBe(200);
  });

  it.each([
    ['get', '/api/mobile/daily'],
    ['post', '/api/mobile/bookings'],
    ['patch', '/api/mobile/bookings/90'],
    ['get', '/api/mobile/user-bookings?user_id=1'],
    ['delete', '/api/mobile/bookings/1'],
    ['get', '/api/mobile/timeslot-id?hour=09:00'],
    ['get', '/api/mobile/product/8/service-info'],
    ['get', '/api/mobile/holidays']
  ])('%s %s -> 401 sin token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('GET /api/mobile/daily -> 500 cuando no existe mapping producto-servicio', async () => {
    bookingRepository.getServiceMappingByProduct.mockResolvedValue(null);

    const res = await withAuth(request(app).get('/api/mobile/daily?product_id=8&date=2026-04-10'));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Error al consultar disponibilidad diaria');
  });

  it('GET /api/mobile/daily -> 200 con slots construidos desde disponibilidad', async () => {
    bookingRepository.getServiceMappingByProduct.mockResolvedValue(8);
    bookingRepository.fetchTimeslots.mockResolvedValue([{ timeslot: '09:00:00' }]);
    bookingRepository.fetchCoaches.mockResolvedValue([
      {
        coach_id: 11,
        coach_name: 'Coach One',
        days: 'fri',
        product_id_morning: 8,
        product_id_afternoon: null,
        capacity_morning: 3,
        capacity_afternoon: null
      }
    ]);
    bookingRepository.fetchBookings.mockResolvedValue([]);
    bookingRepository.fetchAvailability.mockResolvedValue([
      {
        coach_id: 11,
        days: 'fri',
        morning_start_time: '08:00:00',
        morning_end_time: '12:00:00',
        capacity_morning: 3,
        product_id_morning: 8,
        afternoon_start_time: null,
        afternoon_end_time: null,
        capacity_afternoon: null,
        product_id_afternoon: null
      }
    ]);

    const res = await withAuth(request(app).get('/api/mobile/daily?product_id=8&date=2026-04-10'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ product_id: 8, coach_id: 11, hour: '09:00:00', capacity: 3 })
    ]);
  });

  it('POST /api/mobile/bookings -> 409 para reserva duplicada', async () => {
    bookingRepository.findExistingBooking.mockResolvedValue([{ booking_id: 1 }]);

    const payload = { customer_id: 1, coach_id: 2, session_timeslot_id: 3, service_id: 4, product_id: 5, start_date: '2026-04-10' };
    const res = await withAuth(request(app).post('/api/mobile/bookings')).send(payload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Ya existe una reserva');
  });

  it('POST /api/mobile/bookings -> 409 por límite semanal en suscripción recurrente', async () => {
    bookingRepository.findExistingBooking.mockResolvedValue([]);
    bookingRepository.findActiveProduct.mockResolvedValue({
      active_product_id: 99,
      payment_method: 'card',
      payment_status: 'paid',
      type_of_product: 'recurrent',
      total_session: 0,
      service_session_override: 1
    });
    bookingRepository.countWeeklyBookings.mockResolvedValue(1);

    const payload = { customer_id: 1, coach_id: 2, session_timeslot_id: 3, service_id: 4, product_id: 5, start_date: '2026-04-10' };
    const res = await withAuth(request(app).post('/api/mobile/bookings')).send(payload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('máximo semanal');
  });

  it('POST /api/mobile/bookings -> 201 cuando la reserva es válida', async () => {
    bookingRepository.findExistingBooking.mockResolvedValue([]);
    bookingRepository.findActiveProduct.mockResolvedValue({
      active_product_id: 99,
      payment_method: 'card',
      payment_status: 'paid',
      type_of_product: 'single',
      total_session: 5,
      service_session_override: 0
    });
    bookingRepository.countTotalBookings.mockResolvedValue(1);
    bookingRepository.insertBooking.mockResolvedValue(77);

    const payload = { customer_id: 1, coach_id: 2, session_timeslot_id: 3, service_id: 4, product_id: 5, start_date: '2026-04-10' };
    const res = await withAuth(request(app).post('/api/mobile/bookings')).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.booking_id).toBe(77);
  });

  it('PATCH /api/mobile/bookings/:id -> 404 cuando booking no existe', async () => {
    bookingRepository.bookingExists.mockResolvedValue(false);

    const res = await withAuth(request(app).patch('/api/mobile/bookings/90')).send({
      new_coach_id: 2,
      new_service_id: 3,
      new_product_id: 4,
      new_session_timeslot_id: 5,
      new_start_date: '2026-04-12'
    });

    expect(res.status).toBe(404);
  });

  it('GET /api/mobile/user-bookings -> transforma coach_profile_pic con URL base', async () => {
    bookingRepository.fetchUserBookings.mockResolvedValue([
      { id: 1, coach_profile_pic: 'coach.jpg' }
    ]);

    const res = await withAuth(request(app).get('/api/mobile/user-bookings?user_id=1'));

    expect(res.status).toBe(200);
    expect(res.body[0].coach_profile_pic).toContain('/api/profile_pic/coach.jpg');
  });

  it('DELETE /api/mobile/bookings/:id -> 404 si ya está cancelada', async () => {
    bookingRepository.cancelBookingRow.mockResolvedValue(0);

    const res = await withAuth(request(app).delete('/api/mobile/bookings/1'));

    expect(res.status).toBe(404);
  });

  it('GET /api/mobile/timeslot-id -> 404 cuando no existe hora', async () => {
    bookingRepository.findTimeslotByHour.mockResolvedValue(null);

    const res = await withAuth(request(app).get('/api/mobile/timeslot-id?hour=09:00&service_id=3&day_of_week=1'));

    expect(res.status).toBe(404);
  });

  it('GET /api/mobile/product/:id/service-info -> 500 cuando no hay mapeo', async () => {
    bookingRepository.getServiceMappingByProduct.mockResolvedValue(null);

    const res = await withAuth(request(app).get('/api/mobile/product/8/service-info'));

    expect(res.status).toBe(500);
  });

  it('GET /api/mobile/holidays -> 404 cuando no hay festivos próximos', async () => {
    bookingRepository.findUpcomingHolidays.mockResolvedValue([]);

    const res = await withAuth(request(app).get('/api/mobile/holidays'));

    expect(res.status).toBe(404);
  });
});
