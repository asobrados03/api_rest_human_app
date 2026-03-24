import request from 'supertest';
import { jest } from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createVerifyTokenModule,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const bookingService = {
  getDailyAvailabilityService: jest.fn(),
  reserveSessionService: jest.fn(),
  updateBookingService: jest.fn(),
  getUserBookingsService: jest.fn(),
  cancelBookingService: jest.fn(),
  getTimeslotIdService: jest.fn(),
  getProductMappingService: jest.fn(),
  getUpcomingHolidays: jest.fn(),
  getUserProductService: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule({ id: 1, role: 'user' }));
jest.unstable_mockModule('../../services/product-booking.service.js', () => bookingService);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Product Booking API completa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbConnectionMock(mockGetConnection);
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

  it('GET /api/mobile/daily -> 400 query faltante', async () => {
    const res = await withAuth(request(app).get('/api/mobile/daily'));
    expect(res.status).toBe(400);
  });

  it('POST /api/mobile/bookings -> 400 campos faltantes', async () => {
    const res = await withAuth(request(app).post('/api/mobile/bookings')).send({ customer_id: 1 });
    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/daily -> 200', async () => {
    bookingService.getDailyAvailabilityService.mockResolvedValue([{ hour: '10:00' }]);
    const res = await withAuth(request(app).get('/api/mobile/daily?product_id=8&date=2026-04-10'));
    expect(res.status).toBe(200);
  });

  it('POST /api/mobile/bookings -> 201', async () => {
    bookingService.reserveSessionService.mockResolvedValue({ booking_id: 77 });
    const payload = { customer_id: 1, coach_id: 2, session_timeslot_id: 3, service_id: 4, product_id: 5, start_date: '2026-04-10' };
    const res = await withAuth(request(app).post('/api/mobile/bookings')).send(payload);
    expect(res.status).toBe(201);
  });

  it.each([
    ['patch', '/api/mobile/bookings/90', { new_coach_id: 2, new_service_id: 3, new_product_id: 4, new_session_timeslot_id: 5, new_start_date: '2026-04-12' }],
    ['get', '/api/mobile/user-bookings?user_id=1'],
    ['delete', '/api/mobile/bookings/1'],
    ['get', '/api/mobile/timeslot-id?hour=09:00&service_id=3&day_of_week=1'],
    ['get', '/api/mobile/product/8/service-info'],
    ['get', '/api/mobile/holidays']
  ])('%s %s -> 200 con token', async (method, path, body) => {
    bookingService.updateBookingService.mockResolvedValue(undefined);
    bookingService.getUserBookingsService.mockResolvedValue([{ booking_id: 1 }]);
    bookingService.cancelBookingService.mockResolvedValue({ updated: 1 });
    bookingService.getTimeslotIdService.mockResolvedValue(99);
    bookingService.getProductMappingService.mockResolvedValue({ service_id: 3 });
    bookingService.getUpcomingHolidays.mockResolvedValue([{ date: '2026-12-25' }]);

    const req = withAuth(request(app)[method](path));
    const res = body ? await req.send(body) : await req;
    expect([200, 201]).toContain(res.status);
  });

  it('POST /api/mobile/bookings -> 500', async () => {
    bookingService.reserveSessionService.mockRejectedValue(new Error('Booking engine down'));
    const payload = { customer_id: 1, coach_id: 2, session_timeslot_id: 3, service_id: 4, product_id: 5, start_date: '2026-04-10' };
    const res = await withAuth(request(app).post('/api/mobile/bookings')).send(payload);
    expect(res.status).toBe(500);
  });
});
