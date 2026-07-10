/**
 * Portfolio intelligence domain types (Phase 5). Ownership/equity-pickup math and
 * KPI collection over portfolio companies. All money is integer minor units.
 */

export interface PortfolioCompany {
  readonly id: string;
  readonly firmId: string;
  readonly name: string;
  readonly sector: string;
}

/** A fund's position in a portfolio company. */
export interface Investment {
  readonly id: string;
  readonly firmId: string;
  readonly fundId: string;
  readonly companyId: string;
  readonly instrument: string;
  readonly costMinor: number;
  /** Fully-diluted ownership in basis points (10000 = 100%). */
  readonly ownershipBps: number;
  readonly round: string;
  readonly date: string;
  readonly currency: string;
}

/** A fair-value mark for a whole portfolio company (its equity value). */
export interface CompanyValuation {
  readonly companyId: string;
  readonly asOf: string;
  readonly fairValueMinor: number;
  readonly currency: string;
}

/** The computed position of one investment at a valuation point. */
export interface Position {
  readonly investmentId: string;
  readonly companyId: string;
  readonly costMinor: number;
  readonly ownershipBps: number;
  /** The fund's stake value = ownershipBps × company fair value. */
  readonly stakeValueMinor: number;
  /** stakeValue − cost (may be negative). */
  readonly unrealizedGainMinor: number;
  /** Multiple on invested capital in bps (stakeValue / cost × 10000). */
  readonly moicBps: number;
  readonly currency: string;
}

/** A single reported KPI observation from one source. */
export interface KpiRecord {
  readonly companyId: string;
  readonly period: string; // YYYY-Qn or YYYY-MM
  readonly metric: string;
  readonly value: string;
  readonly source: string;
  readonly asOf: string;
}

/** The collected view of one KPI across sources for a period. */
export interface CollectedKpi {
  readonly companyId: string;
  readonly period: string;
  readonly metric: string;
  readonly bySource: readonly {
    readonly source: string;
    readonly value: string;
    readonly asOf: string;
  }[];
  /** The most-recent observation's value (by asOf, ties broken by source). */
  readonly latestValue: string;
  /** True if sources report differing values for the same metric/period. */
  readonly hasDisagreement: boolean;
}
