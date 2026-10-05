import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { bootstrap } from './bootstrap.js';
import { requireJson } from './auth.js';
import { account } from './routes/account.js';
import { conversations } from './routes/conversations.js';
import { leads } from './routes/leads.js';
import { comments } from './routes/comments.js';
import { admin } from './routes/admin.js';
import { analytics } from './routes/analytics.js';
import { simulator } from './routes/simulator.js';
import { webhooks } from './routes/webhooks.js';
import { startSlaLoop } from './services/sla.js';

bootstrap();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx / a load balancer in production

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
  );
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/webhooks', webhooks);

// Large JSON bodies only for file uploads.
app.use('/api', (req, res, next) => express.json({ limit: req.path.endsWith('/attachments') ? '25mb' : '1mb' })(req, res, next));
app.use('/api', requireJson);
app.use('/api', account, conversations, leads, comments, admin, analytics, simulator);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Files we send to customers must be publicly reachable by Meta; names are unguessable.
app.use('/media', express.static(path.join(config.dataDir, 'uploads'), { maxAge: '30d', index: false }));
app.use(express.static(path.join(config.root, 'public'), { index: 'index.html' }));
app.get(/^\/(?!api|webhooks|media).*/, (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
  res.status(status).json({
    error: status >= 500 && config.isProduction && !err.status ? 'Server error' : err.message,
    code: err.code,
  });
});

app.listen(config.port, () => {
  console.log(`Soul Inbox running on ${config.publicUrl} (port ${config.port})`);
  if (!config.meta.appSecret) console.warn('[meta] META_APP_SECRET not set - webhook signatures are NOT verified (dev only)');
});

startSlaLoop();
