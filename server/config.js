import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // no .env file: rely on the real environment
}

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

if (isProduction && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET (32+ chars) is required in production');
}

export const config = {
  root,
  isProduction,
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  sessionDays: Number(env.SESSION_DAYS || 14),
  timezone: env.TIMEZONE || 'Africa/Cairo',

  meta: {
    appId: env.META_APP_ID || '',
    appSecret: env.META_APP_SECRET || '',
    verifyToken: env.META_VERIFY_TOKEN || '',
    graphVersion: env.META_GRAPH_VERSION || 'v23.0',
  },

  ai: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
  },

  simulatorEnabled: env.SIMULATOR_ENABLED ? env.SIMULATOR_ENABLED === 'true' : !isProduction,

  bootstrapAdmin: {
    email: env.ADMIN_EMAIL || 'admin@soul.local',
    password: env.ADMIN_PASSWORD || 'ChangeMe!2026',
    name: env.ADMIN_NAME || 'Admin',
  },
};
