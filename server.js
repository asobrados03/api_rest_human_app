import 'dotenv/config';
import app from './app.js';
import { createServer } from 'http';

const PORT = process.env.PORT || 8085;
const HOST = '0.0.0.0';

const server = createServer(app);

server.keepAliveTimeout = 0;
server.headersTimeout   = 5000;     // debe ser mayor que keepAliveTimeout

server.listen(PORT, HOST, () => {
    console.log(`API REST corriendo en http://${HOST}:${PORT}`);
    console.log(`Caddy debería estar proxy_pass → http://127.0.0.1:${PORT}`);
});
