/** Active client company for the session (drives scoping of every page). */
const KEY = 'zvz.activeCompany';

export function activeCompanyId(): string | null {
  return localStorage.getItem(KEY);
}

export function setActiveCompanyId(id: string): void {
  localStorage.setItem(KEY, id);
}
