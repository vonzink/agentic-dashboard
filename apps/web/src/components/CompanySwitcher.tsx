import { useEffect } from 'react';
import { useCompanies } from '../api/hooks';
import { activeCompanyId, setActiveCompanyId } from '../lib/company';

/**
 * Active-client selector. Every page scopes its data to this company;
 * switching reloads so all queries re-fetch under the new scope.
 */
export function CompanySwitcher() {
  const companies = useCompanies();
  const items = (companies.data?.items ?? []).filter((c) => c.is_active);
  const active = activeCompanyId();

  // First load (or stale selection): default to the first company.
  useEffect(() => {
    if (!items.length) return;
    if (!active || !items.some((c) => c.id === active)) {
      setActiveCompanyId(items[0]!.id);
      if (active) window.location.reload(); // stale id — rescope
    }
  }, [items, active]);

  if (!items.length) return null;
  return (
    <select
      value={active ?? items[0]!.id}
      onChange={(e) => {
        setActiveCompanyId(e.target.value);
        window.location.reload();
      }}
      style={{ width: 'auto', marginTop: 0 }}
      title="Active client company — all pages are scoped to it"
    >
      {items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
