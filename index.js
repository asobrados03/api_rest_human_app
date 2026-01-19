import 'dotenv/config';
import app from './app.js';
import { createServer } from 'http';

console.log('--- Verificación de Entorno ---');
console.log('CWD:', process.cwd());
console.log('JWT Key existe:', !!process.env.SECRET_JWT_KEY);
console.log('-------------------------------');

const PORT = process.env.PORT || 8085;
const HOST = '0.0.0.0';   // imprescindible en Azure/Caddy

const server = createServer(app);

server.listen(PORT, HOST, () => {
    console.log(`API REST corriendo en https://${HOST}:${PORT}`);
    console.log(`Caddy debería estar proxy_pass → http://127.0.0.1:${PORT}`);
});
