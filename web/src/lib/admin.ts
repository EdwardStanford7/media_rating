export const ADMIN_ROLE = "admin";
export const USER_ROLE = "user";

export function parseRoleList(role: string | string[] | null | undefined) {
    const roles = Array.isArray(role) ? role : (role ?? "").split(",");
    return roles.map((candidate) => candidate.trim()).filter(Boolean);
}

export function hasAdminRole(user: { role?: string | string[] | null } | null | undefined) {
    return parseRoleList(user?.role).includes(ADMIN_ROLE);
}
