// Role -> permissions. Admin implicitly has everything.
const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'conv.view_all', 'conv.reply_any', 'conv.assign', 'analytics.team', 'users.manage', 'settings.manage',
    'templates.manage', 'comments.manage', 'leads.reopen', 'audit.view',
  ],
  supervisor: ['conv.view_all', 'conv.reply_any', 'conv.assign', 'analytics.team', 'templates.manage', 'comments.manage', 'audit.view'],
  agent: [],
};

// Only admins: channel credentials and creating other admins.
export const ADMIN_ONLY = ['channels.manage', 'users.manage_admins', 'simulator'];

export const ROLES = Object.keys(ROLE_PERMISSIONS);

export function can(user, permission) {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role] || [];
  return perms.includes('*') || perms.includes(permission);
}

export function permissionsFor(user) {
  const perms = ROLE_PERMISSIONS[user.role] || [];
  if (perms.includes('*')) {
    return [...new Set(Object.values(ROLE_PERMISSIONS).flat().filter((p) => p !== '*').concat(ADMIN_ONLY))];
  }
  return perms;
}
