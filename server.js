import './config/env.js';
import app from './app.js';
import { createServer } from 'http';

import logger from './utils/pino.js';

const PORT = process.env.PORT || 8085;
const HOST = '127.0.0.1';

const server = createServer(app);

server.keepAliveTimeout = 0;
server.headersTimeout   = 5000;     // debe ser mayor que keepAliveTimeout

server.listen(PORT, HOST, () => {
    logger.info(`API REST corriendo en http://${HOST}:${PORT}`);
    logger.info(`Caddy debería estar proxy_pass → http://127.0.0.1:${PORT}`);
});
