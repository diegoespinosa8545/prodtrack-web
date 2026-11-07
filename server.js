// Pro(D)Track · servidor web: API REST + frontend estático
require('./src/env');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use('/api', require('./src/routes'));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pro(D)Track escuchando en http://localhost:${PORT}`));
