import { ApiError } from '../middleware/error';
import type { Store } from '../repositories/interfaces';
import type { AuthUser, Company } from '../types/domain';
import type { AuditService } from './audit';

/**
 * Client companies the dashboard is operated for (ZVZ Solutions runs the
 * platform; MSFG is the first client). Tasks and documents are owned by a
 * company; retrieval is scoped by it. Companies are never deleted — they
 * deactivate, preserving every audit trail.
 */
export class CompanyService {
  constructor(
    private store: Store,
    private audit: AuditService,
  ) {}

  list(): Promise<Company[]> {
    return this.store.companies.list();
  }

  async create(actor: AuthUser, body: { name: string; slug: string }): Promise<Company> {
    if (await this.store.companies.getBySlug(body.slug)) {
      throw ApiError.conflict('SLUG_TAKEN', `Company slug '${body.slug}' already exists`);
    }
    const company = await this.store.companies.create({
      name: body.name,
      slug: body.slug,
      is_active: true,
      monthly_budget: null,
    });
    await this.audit.record('company.created', {
      actor: actor.email,
      companyId: company.id,
      payload: { name: company.name, slug: company.slug },
    });
    return company;
  }

  async update(
    actor: AuthUser,
    id: string,
    patch: { name?: string; is_active?: boolean; monthly_budget?: number | null },
  ): Promise<Company> {
    const { monthly_budget, ...rest } = patch;
    const updated = await this.store.companies.update(id, {
      ...rest,
      ...(monthly_budget !== undefined && {
        monthly_budget: monthly_budget === null ? null : monthly_budget.toFixed(2),
      }),
    });
    if (!updated) throw ApiError.notFound('Company');
    await this.audit.record('company.updated', {
      actor: actor.email,
      companyId: id,
      payload: { patch },
    });
    return updated;
  }

  /**
   * Month-to-date AI spend vs the company's monthly budget. Budgets are a
   * soft limit: the UI warns, runs are never blocked (a hard stop could
   * freeze compliance work mid-month).
   */
  async budgetStatus(companyId?: string | null): Promise<{
    company_id: string;
    company_name: string;
    month: string;
    monthly_budget: string | null;
    month_to_date: string;
    ratio: number | null;
  }> {
    const company = await this.resolve(companyId);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const usage = await this.store.runs.usageSummary(monthStart, company.id);
    const spend = Number(usage.totals.estimated_cost);
    const budget = company.monthly_budget === null ? null : Number(company.monthly_budget);
    return {
      company_id: company.id,
      company_name: company.name,
      month: monthStart.slice(0, 7),
      monthly_budget: company.monthly_budget,
      month_to_date: spend.toFixed(6),
      ratio: budget && budget > 0 ? Number((spend / budget).toFixed(4)) : null,
    };
  }

  /**
   * Resolves the company for a new task/document: an explicit id must
   * exist and be active; omitted falls back to the OLDEST active company
   * (the founding client) — a stable default that adding new companies
   * can never silently change. The UI always sends an explicit id.
   */
  async resolve(companyId?: string | null): Promise<Company> {
    if (companyId) {
      const company = await this.store.companies.get(companyId);
      if (!company) throw ApiError.badRequest('company_id does not exist');
      if (!company.is_active) {
        throw ApiError.conflict('COMPANY_INACTIVE', `${company.name} is deactivated`);
      }
      return company;
    }
    const active = (await this.store.companies.list())
      .filter((c) => c.is_active)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!active.length) {
      throw ApiError.conflict('NO_COMPANIES', 'No active companies exist — create one in Admin');
    }
    return active[0]!;
  }
}
