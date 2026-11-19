const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const { authenticate, requireRole } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { pool } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.corsOrigin.includes('*') ? true : config.corsOrigin }));
app.use(express.json({ limit: '100kb' }));
if (config.env !== 'test') app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (_) {
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));
app.use('/api/discover', authenticate, require('./routes/discovery'));
app.use('/api/safety', authenticate, require('./routes/safety'));

const api = express.Router();
api.use(authenticate);
api.use(require('./routes/profile'));
api.use(require('./routes/connections'));
app.use('/api', api);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
