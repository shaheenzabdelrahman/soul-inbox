import { api } from './util.js';

// Shared, read-mostly state loaded from /api/me.
export const store = {
  me: null,
  user: null,
  permissions: new Set(),
  users: [],
  channels: [],
  stages: [],
  lostReasons: [],
  templates: [],
  rules: {},
  viewers: {},
  aiAvailable: false,
  simulator: false,
  businessNow: true,
};

export async function loadMe() {
  const me = await api('GET', '/me');
  Object.assign(store, {
    me,
    user: me.user,
    permissions: new Set(me.permissions),
    users: me.users,
    channels: me.channels,
    stages: me.stages,
    lostReasons: me.lostReasons,
    templates: me.templates,
    rules: me.rules,
    viewers: me.viewers || {},
    aiAvailable: me.aiAvailable,
    simulator: me.simulator,
    businessNow: me.businessNow,
  });
  return store;
}

export const can = (p) => store.permissions.has(p);
export const userName = (id) => store.users.find((u) => u.id === id)?.name || '';
export const stageByKey = (key) => store.stages.find((s) => s.key === key);
