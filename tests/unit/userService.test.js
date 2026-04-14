/**
 * Módulo testeado: services/user.service.js
 * Dependencias mockeadas: repositories/user.repository.js, middlewares/uploadProfile_Pic.js y utils/pino.js por acceso externo (DB/filesystem/logger).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRepo = {
  findUserById: jest.fn(),
  findProfilePicName: jest.fn(),
  updateUserDynamic: jest.fn(),
  findUserByEmail: jest.fn(),
  deleteUserByEmail: jest.fn(),
  getStatsLastMonth: jest.fn(),
  getStatsTopCoach: jest.fn(),
  getStatsPending: jest.fn()
};

jest.unstable_mockModule('../../repositories/user.repository.js', () => mockRepo);
jest.unstable_mockModule('../../middlewares/uploadProfile_Pic.js', () => ({ UPLOAD_PATH: '/tmp/profile' }));
jest.unstable_mockModule('../../utils/pino.js', () => ({ default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const {
  getUserByIdService,
  updateUserService,
  deleteUserService,
  getUserStatsService
} = await import('../../services/user.service.js');

describe('Unit - user service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserByIdService', () => {
    it('retorna null cuando no encuentra usuario', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.findUserById.mockResolvedValue(null);

      const result = await getUserByIdService(dbPool, 9);

      expect(result).toBeNull();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('normaliza postcode, dni y profilePictureName', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.findUserById.mockResolvedValue({ postcode: '28001', dni: '', profilePictureName: '' });

      const result = await getUserByIdService(dbPool, 7);

      expect(result).toEqual({ postcode: 28001, dni: null, profilePictureName: null });
    });
  });

  describe('updateUserService', () => {
    it('lanza 400 si falta el campo user serializado', async () => {
      await expect(updateUserService({}, { rawUserJson: '', tokenPayload: { id: 1, email: 'a@a.com' } }))
        .rejects.toMatchObject({ status: 400 });
    });

    it('lanza 401 si id/email no coinciden con el token', async () => {
      const payload = { id: 1, email: 'a@a.com' };
      const rawUserJson = JSON.stringify({ id: 2, email: 'a@a.com' });

      await expect(updateUserService({}, { rawUserJson, tokenPayload: payload }))
        .rejects.toMatchObject({ status: 401, message: 'No estás autorizado' });
    });

    it('lanza 400 con formato de fecha inválido', async () => {
      const payload = { id: 1, email: 'a@a.com' };
      const rawUserJson = JSON.stringify({ id: 1, email: 'a@a.com', dateOfBirth: '2026-01-01' });

      await expect(updateUserService({}, { rawUserJson, tokenPayload: payload }))
        .rejects.toMatchObject({ status: 400, message: 'Formato de fecha inválido: esperado DD/MM/YYYY' });
    });

    it('actualiza usuario y retorna registro formateado', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };

      const payload = { id: 1, email: 'a@a.com' };
      const rawUserJson = JSON.stringify({
        id: 1,
        email: 'a@a.com',
        fullName: 'Ana',
        dateOfBirth: '01/02/2000',
        postcode: '28001',
        dni: ''
      });

      mockRepo.findUserById.mockResolvedValue({ id: 1, postcode: '28001', dni: '', profilePictureName: '' });

      const result = await updateUserService(dbPool, { rawUserJson, tokenPayload: payload });

      expect(mockRepo.updateUserDynamic).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 1, postcode: 28001, dni: null, profilePictureName: null });
    });

    it('hace rollback y propaga error si falla una operación de repositorio', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      const payload = { id: 1, email: 'a@a.com' };
      const rawUserJson = JSON.stringify({ id: 1, email: 'a@a.com', fullName: 'Ana' });

      mockRepo.updateUserDynamic.mockRejectedValue(new Error('db timeout'));

      await expect(updateUserService(dbPool, { rawUserJson, tokenPayload: payload }))
        .rejects.toThrow('db timeout');

      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('hace rollback si falla el commit', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn().mockRejectedValue(new Error('commit failed')),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      const payload = { id: 1, email: 'a@a.com' };
      const rawUserJson = JSON.stringify({ id: 1, email: 'a@a.com', fullName: 'Ana' });

      mockRepo.findUserById.mockResolvedValue({ id: 1, postcode: '28001', dni: '', profilePictureName: '' });
      mockRepo.updateUserDynamic.mockResolvedValue(undefined);

      await expect(updateUserService(dbPool, { rawUserJson, tokenPayload: payload }))
        .rejects.toThrow('commit failed');

      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteUserService', () => {
    it('lanza 401 cuando el email no coincide con tokenEmail', async () => {
      await expect(deleteUserService({}, { rawEmail: 'a@a.com', tokenEmail: 'b@b.com' }))
        .rejects.toMatchObject({ status: 401, message: 'No estás autorizado' });
    });

    it('lanza 404 cuando usuario no existe', async () => {
      const connection = { beginTransaction: jest.fn(), rollback: jest.fn(), release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.findUserByEmail.mockResolvedValue(null);

      await expect(deleteUserService(dbPool, { rawEmail: 'a@a.com', tokenEmail: 'a@a.com' }))
        .rejects.toMatchObject({ status: 404 });
    });

    it('elimina usuario y retorna id/email', async () => {
      const connection = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.findUserByEmail.mockResolvedValue({ user_id: 5 });
      mockRepo.deleteUserByEmail.mockResolvedValue(1);

      const result = await deleteUserService(dbPool, { rawEmail: ' A@A.com ', tokenEmail: ' A@A.com ' });

      expect(mockRepo.deleteUserByEmail).toHaveBeenCalledWith(connection, 'a@a.com');
      expect(result).toEqual({ userId: 5, email: 'a@a.com' });
    });
  });

  describe('getUserStatsService', () => {
    it('suma métricas y devuelve coach más frecuente', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };

      mockRepo.getStatsLastMonth.mockResolvedValue([{ total: 2 }, { total: 3 }]);
      mockRepo.getStatsTopCoach.mockResolvedValue([{ coach_name: 'Luis', cnt: 1 }, { coach_name: 'Ana', cnt: 4 }]);
      mockRepo.getStatsPending.mockResolvedValue([{ total: 1 }, { total: 0 }]);

      const result = await getUserStatsService(dbPool, 7);

      expect(result).toEqual({
        last_month_workouts: 5,
        pending_bookings: 1,
        most_frequent_trainer: 'Ana'
      });
    });
  });
});
