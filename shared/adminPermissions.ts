export const ADMIN_SECTION_ACTIONS = {
  dashboard: ['view'],
  leads: ['view', 'edit', 'export'],
  serviceStore: ['view', 'create', 'edit', 'delete', 'publish'],
  content: ['view', 'edit', 'publish'],
  mascot: ['view', 'edit', 'publish'],
  caseStudies: ['view', 'create', 'edit', 'delete', 'publish'],
  servicesManagement: ['view', 'create', 'edit', 'delete', 'publish'],
  blogs: ['view', 'create', 'edit', 'delete', 'publish'],
  team: ['view', 'create', 'edit', 'delete'],
  categories: ['view', 'create', 'edit', 'delete'],
  securityMonitoring: ['view', 'edit'],
  settings: ['view'],
} as const;

export type AdminSection = keyof typeof ADMIN_SECTION_ACTIONS;
export type AdminAction = (typeof ADMIN_SECTION_ACTIONS)[AdminSection][number];
export type AdminPermissions = Partial<Record<AdminSection, Partial<Record<AdminAction, boolean>>>>;

export const DEFAULT_SUPER_ADMIN_PERMISSIONS: AdminPermissions = {
  dashboard: { view: true },
  leads: { view: true, edit: true, export: true },
  serviceStore: { view: true, create: true, edit: true, delete: true, publish: true },
  content: { view: true, edit: true, publish: true },
  mascot: { view: true, edit: true, publish: true },
  caseStudies: { view: true, create: true, edit: true, delete: true, publish: true },
  servicesManagement: { view: true, create: true, edit: true, delete: true, publish: true },
  blogs: { view: true, create: true, edit: true, delete: true, publish: true },
  team: { view: true, create: true, edit: true, delete: true },
  categories: { view: true, create: true, edit: true, delete: true },
  settings: { view: true },
};

export function validateAdminPermissions(value: unknown): AdminPermissions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: AdminPermissions = {};
  for (const [section, rawActions] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(ADMIN_SECTION_ACTIONS, section) ||
      !rawActions || typeof rawActions !== 'object' || Array.isArray(rawActions)) {
      return undefined;
    }

    const actions: Partial<Record<AdminAction, boolean>> = {};
    const allowedActions = ADMIN_SECTION_ACTIONS[section as AdminSection] as readonly AdminAction[];
    for (const [action, enabled] of Object.entries(rawActions)) {
      if (!allowedActions.includes(action as AdminAction) || typeof enabled !== 'boolean') return undefined;
      actions[action as AdminAction] = enabled;
    }
    if (Object.entries(actions).some(([action, enabled]) => action !== 'view' && enabled) && actions.view !== true) {
      return undefined;
    }
    output[section as AdminSection] = actions;
  }
  return output;
}
