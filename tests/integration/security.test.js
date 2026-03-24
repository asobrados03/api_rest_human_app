import request from 'supertest';

const { default: app } = await import('../../app.js');

describe('Integración - Seguridad y autenticación', () => {
  it('GET /api/mobile/user -> 401 y WWW-Authenticate cuando no hay token', async () => {
    const response = await request(app).get('/api/mobile/user');

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toMatch(/Bearer realm="HumanPerform"/);
    expect(response.body).toEqual({ error: 'Token not provided' });
  });

  it('GET /api/stripe/customer/cus_123 -> 401 y WWW-Authenticate cuando no hay token', async () => {
    const response = await request(app).get('/api/stripe/customer/cus_123');

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toMatch(/Bearer realm="HumanPerform"/);
    expect(response.body).toEqual({ error: 'Token not provided' });
  });
});
