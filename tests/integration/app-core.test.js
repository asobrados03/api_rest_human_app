import request from 'supertest';

const { default: app } = await import('../../app.js');

describe('Integración - Core API routes', () => {
  it('GET /api/ping -> responde 200 con mensaje esperado', async () => {
    const response = await request(app).get('/api/ping');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ message: '¡ping, funcionó!' });
  });

  it('GET /api/document/:filename -> 404 cuando el archivo no existe', async () => {
    const response = await request(app).get('/api/document/no-existe.pdf');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ error: 'Document not found' });
  });

  it('GET /ruta-inexistente -> 404 con estructura de error de ruta', async () => {
    const response = await request(app).get('/ruta-que-no-existe');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'Ruta no encontrada',
      path: '/ruta-que-no-existe'
    });
  });
});
