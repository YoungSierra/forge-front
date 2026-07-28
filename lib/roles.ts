// Rol de PLATAFORMA (V57). Tolera 'admin' (valor actual) y 'super_admin' (tras el rename),
// para que el rename de roles pueda hacerse sin romper los gates del front.
export function isPlatformAdmin(role?: string | null): boolean {
  return role === 'admin' || role === 'super_admin'
}
