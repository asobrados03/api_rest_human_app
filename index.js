import app from './app.js';

const PORT = 8085;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`✅ API REST de Human Performance App corriendo en http://localhost:${PORT}`);
});
