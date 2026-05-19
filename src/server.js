require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database');
const authRouter = require('./routes/auth');
const repartosRouter = require('./routes/repartos');
const estancoRouter = require('./routes/estanco');
const cajaRouter = require('./routes/caja');
const vendingRouter = require('./routes/vending');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secreto-desarrollo-cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 8 * 60 * 60 * 1000 // 8 horas
  }
}));

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'No autorizado' });
  }
}

function requireGerente(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'gerente') {
    next();
  } else {
    res.status(403).json({ error: 'Solo gerentes pueden hacer esto' });
  }
}

// Rutas API
app.use('/api/auth', authRouter);
app.use('/api/repartos', requireAuth, repartosRouter);
app.use('/api/estanco', requireAuth, estancoRouter);
app.use('/api/caja', requireAuth, cajaRouter);
app.use('/api/vending', requireAuth, requireGerente, vendingRouter);

// Endpoint para obtener usuario actual
app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: 'No autenticado' });
  }
});

// Todas las demás rutas sirven el frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
  console.log(`🏪 Gestión Estanco - App lista`);
});
