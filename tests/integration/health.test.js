import request from 'supertest';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockGetConnection = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  default: {
    getConnection: mockGetConnection
  }
}));

const { default: app } = await import('../../app.js');

describe('Integración - Health endpoint (/api/health)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debe responder ok=true cuando la DB responde al ping', async () => {
    const mockRelease = jest.fn();
    const mockPing = jest.fn().mockResolvedValue(undefined);

    mockGetConnection.mockResolvedValue({
      ping: mockPing,
      release: mockRelease
    });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ ok: true });
    expect(mockPing).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('debe responder 500 cuando falla la conexión a DB', async () => {
    mockGetConnection.mockRejectedValue(new Error('connection timeout'));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'DB not responding' });
  });
});
