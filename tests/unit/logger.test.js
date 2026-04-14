/**
 * Módulo testeado: utils/logger.js
 * Dependencias mockeadas: utils/pino.js porque es un logger externo y solo validamos interacción.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();

jest.unstable_mockModule('../../utils/pino.js', () => ({
  default: {
    info: mockInfo,
    warn: mockWarn,
    error: mockError
  }
}));

const { logActivity } = await import('../../utils/logger.js');

describe('Unit - logger utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logActivity', () => {
    it('omite query y registra warning cuando req.app no tiene db', async () => {
      const req = {
        app: { get: jest.fn().mockReturnValue(undefined) },
        method: 'GET',
        originalUrl: '/users',
        ip: '127.0.0.1',
        headers: {}
      };

      await logActivity(req, { subject: 'consulta', userId: 5 });

      expect(mockWarn).toHaveBeenCalledWith({ subject: 'consulta', userId: 5 }, expect.any(String));
      expect(mockInfo).not.toHaveBeenCalled();
    });

    it('inserta actividad cuando hay conexión db disponible', async () => {
      const query = jest.fn().mockResolvedValue({ affectedRows: 1 });
      const req = {
        app: { get: jest.fn().mockReturnValue({ query }) },
        method: 'POST',
        originalUrl: '/auth/login',
        ip: '10.0.0.10',
        headers: { 'user-agent': 'jest-agent' }
      };

      await logActivity(req, { subject: 'login', userId: 7 });

      expect(mockInfo).toHaveBeenCalledWith(
        { subject: 'login', method: 'POST', url: '/auth/login', userId: 7 },
        '📝 Logging activity'
      );
      expect(query).toHaveBeenCalledTimes(1);
      const [, params] = query.mock.calls[0];
      expect(params).toEqual(expect.arrayContaining(['login', '/auth/login', 'POST', 7]));
    });

    it('captura errores de la query y los registra sin lanzar excepción', async () => {
      const dbError = new Error('db unavailable');
      const req = {
        app: { get: jest.fn().mockReturnValue({ query: jest.fn().mockRejectedValue(dbError) }) },
        method: 'DELETE',
        originalUrl: '/users/7',
        ip: '10.0.0.11',
        headers: {}
      };

      await expect(logActivity(req, { subject: 'delete-user', userId: 7 })).resolves.toBeUndefined();

      expect(mockError).toHaveBeenCalledTimes(2);
      expect(mockError).toHaveBeenNthCalledWith(
        1,
        { err: dbError, subject: 'delete-user', userId: 7 },
        '⚠️ Failed to write log activity'
      );
    });
  });
});
