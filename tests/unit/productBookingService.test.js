/**
 * Módulo testeado: services/product-booking.service.js
 * Dependencias mockeadas: repositories/product-booking.repository.js, utils/date-handler.js y utils/pino.js por acceso DB/fechas/log externo.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRepo = {
  getServiceMappingByProduct: jest.fn(),
  fetchTimeslots: jest.fn(),
  fetchCoaches: jest.fn(),
  fetchBookings: jest.fn(),
  fetchAvailability: jest.fn(),
  cancelBookingRow: jest.fn(),
  findTimeslotByHour: jest.fn()
};

const mockDateUtils = {
  getDayAliasForDate: jest.fn(),
  parseDayAliases: jest.fn(),
  matchesDayAlias: jest.fn()
};

jest.unstable_mockModule('../../repositories/product-booking.repository.js', () => mockRepo);
jest.unstable_mockModule('../../utils/date-handler.js', () => mockDateUtils);
jest.unstable_mockModule('../../utils/pino.js', () => ({ default: { debug: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const {
  getDailyAvailabilityService,
  cancelBookingService,
  getTimeslotIdService
} = await import('../../services/product-booking.service.js');

describe('Unit - product-booking service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDateUtils.getDayAliasForDate.mockReturnValue('mon');
    mockDateUtils.parseDayAliases.mockReturnValue(new Set(['mon']));
    mockDateUtils.matchesDayAlias.mockReturnValue(true);
  });

  describe('getDailyAvailabilityService', () => {
    it('lanza error si no hay mapping de service_id para producto', async () => {
      const connection = { release: jest.fn() };
      const db = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.getServiceMappingByProduct.mockResolvedValue(null);

      await expect(getDailyAvailabilityService({ productId: 2, date: '2026-03-24', db }))
        .rejects.toThrow('No se encontró un service_id para el producto 2');
    });

    it('retorna disponibilidad para coaches dentro de rango y producto', async () => {
      const connection = { release: jest.fn() };
      const db = { getConnection: jest.fn().mockResolvedValue(connection) };

      mockRepo.getServiceMappingByProduct.mockResolvedValue(100);
      mockRepo.fetchTimeslots.mockResolvedValue([{ timeslot: '09:00:00' }]);
      mockRepo.fetchCoaches.mockResolvedValue([
        {
          coach_id: 9,
          coach_name: 'Coach 1',
          days: 'mon',
          product_id_morning: 2,
          product_id_afternoon: null,
          capacity_morning: 4,
          capacity_afternoon: null
        }
      ]);
      mockRepo.fetchBookings.mockResolvedValue([]);
      mockRepo.fetchAvailability.mockResolvedValue([
        {
          coach_id: 9,
          days: 'mon',
          morning_start_time: '08:00:00',
          morning_end_time: '10:00:00',
          product_id_morning: 2,
          capacity_morning: 4,
          afternoon_start_time: null,
          afternoon_end_time: null,
          product_id_afternoon: null,
          capacity_afternoon: null
        }
      ]);

      const result = await getDailyAvailabilityService({ productId: 2, date: '2026-03-24', db });

      expect(result).toEqual([
        expect.objectContaining({
          product_id: 2,
          hour: '09:00:00',
          coach_id: 9,
          capacity: 4
        })
      ]);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelBookingService', () => {
    it('lanza 404 cuando no se actualiza ninguna reserva', async () => {
      const connection = { release: jest.fn() };
      const db = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.cancelBookingRow.mockResolvedValue(0);

      await expect(cancelBookingService({ bookingId: 20, db })).rejects.toMatchObject({
        status: 404,
        message: 'Reserva no encontrada o ya cancelada'
      });
    });

    it('retorna updated cuando cancela reserva', async () => {
      const connection = { release: jest.fn() };
      const db = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.cancelBookingRow.mockResolvedValue(1);

      const result = await cancelBookingService({ bookingId: 20, db });

      expect(result).toEqual({ updated: 1 });
      expect(mockRepo.cancelBookingRow).toHaveBeenCalledWith(connection, 20);
    });
  });

  describe('getTimeslotIdService', () => {
    it('normaliza hora HH:mm y retorna session_timeslot_id', async () => {
      const connection = { release: jest.fn() };
      const db = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.findTimeslotByHour.mockResolvedValue({ session_timeslot_id: 99 });

      const result = await getTimeslotIdService({ hour: '09:30', serviceId: 7, dayOfWeek: 'mon', db });

      expect(mockRepo.findTimeslotByHour).toHaveBeenCalledWith(connection, '09:30:00', 7, 'mon');
      expect(result).toBe(99);
    });

    it('lanza 404 cuando no encuentra hora', async () => {
      const connection = { release: jest.fn() };
      const db = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.findTimeslotByHour.mockResolvedValue(null);

      await expect(getTimeslotIdService({ hour: '09:30:00', serviceId: 7, dayOfWeek: 'mon', db }))
        .rejects.toMatchObject({ status: 404, message: 'Hora no encontrada' });
    });
  });
});
