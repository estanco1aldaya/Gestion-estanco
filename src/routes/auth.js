const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// Login
router.post('/login', (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  req.session.user = {
    id: user.id,
    nombre: user.nombre,
    usuario: user.usuario,
    rol: user.rol
  };

  res.json({ ok: true, user: req.session.user });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Cambiar contraseña
router.post('/cambiar-password', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });

  const { password_actual, password_nueva } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(password_actual, user.password_hash)) {
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  }

  const hash = bcrypt.hashSync(password_nueva, 10);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// Listar usuarios (solo gerente)
router.get('/usuarios', (req, res) => {
  if (!req.session.user || req.session.user.rol !== 'gerente') {
    return res.status(403).json({ error: 'Solo gerentes' });
  }
  const users = db.prepare('SELECT id, nombre, usuario, rol, activo FROM usuarios').all();
  res.json(users);
});

// Crear usuario (solo gerente)
router.post('/usuarios', (req, res) => {
  if (!req.session.user || req.session.user.rol !== 'gerente') {
    return res.status(403).json({ error: 'Solo gerentes' });
  }
  const { nombre, usuario, password, rol } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)').run(nombre, usuario, hash, rol);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'El usuario ya existe' });
  }
});

module.exports = router;
