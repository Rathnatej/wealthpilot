import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
});

// ---------- token handling ----------
const TOKEN_KEY = "wp_token";
export const getToken = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
};

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // An expired/invalid session: clear it and let the AuthProvider react.
    if (err?.response?.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event("auth:logout"));
    }
    return Promise.reject(err);
  },
);

export function errMsg(e: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) return "Cannot reach the API. Is the backend running?";
    const d = e.response.data?.detail;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && typeof d.message === "string") return d.message;
    if (Array.isArray(d) && d.length) return d.map((x: { msg: string }) => x.msg).join("; ");
  }
  return fallback;
}

// ---------- types ----------
export type Twin = {
  current_corpus: number;
  monthly_sip: number;
  annual_return: number;
  monthly_emi: number;
  emi_months: number;
  years: number;
};

export type Scenario = {
  name: string;
  sip_delta: number;
  new_loan_emi: number;
  new_loan_months: number;
  lump_sum: number;
  return_delta: number;
};

export type SimResult = {
  name: string;
  series: { month: number; corpus: number }[];
  final_corpus: number;
};

export type SimResponse = { baseline: SimResult; scenarios: SimResult[] };

export type User = { id: number; email: string; name: string };
export type AuthResponse = { access_token: string; token_type: string; user: User };

export type AssetKind = "cash" | "epf" | "ppf" | "equity_mf" | "gold" | "real_estate" | "other";
export type Asset = { kind: AssetKind; name: string; value: number };
export type Liability = {
  name: string;
  principal: number;
  interest_rate: number; // fraction
  remaining_months: number;
  monthly_emi: number;
};
export type SavedTwin = {
  monthly_income: number;
  monthly_expenses: number;
  monthly_sip: number;
  annual_return: number; // fraction
  assets: Asset[];
  liabilities: Liability[];
};
export type SavedTwinOut = SavedTwin & {
  version_id: number;
  created_at: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
};
export type TwinPoint = {
  version_id: number;
  created_at: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
};

export type GoalInput = {
  name: string;
  target_amount: number;
  target_date: string; // YYYY-MM-DD
  inflation_rate: number;
  current_saved: number;
  monthly_contribution: number;
  expected_return: number;
};
export type Goal = GoalInput & {
  id: number;
  years_left: number;
  inflated_target: number;
  projected_value: number;
  progress_pct: number;
  on_track: boolean;
  required_monthly_contribution: number;
  shortfall: number;
};

// ---------- calls ----------
export const simulate = (twin: Twin, scenarios: Scenario[]) =>
  api.post<SimResponse>("/simulate", { twin, scenarios }).then((r) => r.data);

export const signup = (email: string, password: string, name: string) =>
  api.post<AuthResponse>("/auth/signup", { email, password, name }).then((r) => r.data);
export const login = (email: string, password: string) =>
  api.post<AuthResponse>("/auth/login", { email, password }).then((r) => r.data);
export const googleLogin = (credential: string) =>
  api.post<AuthResponse>("/auth/google", { credential }).then((r) => r.data);
export const fetchMe = () => api.get<User>("/auth/me").then((r) => r.data);

export const saveTwin = (t: SavedTwin) => api.post<SavedTwinOut>("/twin", t).then((r) => r.data);
export const latestTwin = () => api.get<SavedTwinOut | null>("/twin/latest").then((r) => r.data);
export const twinHistory = () => api.get<TwinPoint[]>("/twin/history").then((r) => r.data);

export const listGoals = () => api.get<Goal[]>("/goals").then((r) => r.data);
export const createGoal = (g: GoalInput) => api.post<Goal>("/goals", g).then((r) => r.data);
export const deleteGoal = (id: number) => api.delete(`/goals/${id}`);

export interface CopilotResult {
  refused: boolean;
  message: string;
  scenario: Scenario | null;
  assumptions: string[];
  simulation: SimResponse | null;
  explanation: string;
  source: "ai" | "template";
  parsed_by: "ai" | "rules";
}

/** Natural-language what-if. The engine computes every number; AI only words it. */
export const copilot = (query: string) =>
  api.post<CopilotResult>("/ai/copilot", { query }).then((r) => r.data);

// ---- Credit health coach ----
export interface CreditCard { name: string; limit: number; balance: number; apr: number; min_due?: number | null; due_day?: number | null }
export interface CreditLoan { name: string; emi: number; outstanding: number }
export interface CreditRequest {
  score: number | null;
  monthly_income: number;
  cards: CreditCard[];
  loans: CreditLoan[];
  missed_payments_12m: number;
  has_settled_or_written_off: boolean;
  oldest_account_years: number;
  enquiries_6m: number;
  monthly_card_budget: number;
}
export interface PayoffRun {
  strategy: string; months: number; total_interest: number; cleared: boolean;
  months_to_30pct: number | null; months_to_10pct: number | null;
}
export interface CreditResult {
  score: number | null;
  band: { name: string; next_band: string | null; points_to_next_band: number } | null;
  utilization_pct: number | null;
  dti_pct: number | null;
  monthly_obligations: number;
  factors: { key: string; label: string; impact: string; status: "good" | "warn" | "bad"; value: string; why: string }[];
  factor_counts: { good: number; warn: number; bad: number };
  cards: { name: string; utilization_pct: number; pay_to_30pct: number; pay_to_10pct: number; limit_needed_for_30pct: number }[];
  actions: { when: string; title: string; detail: string; priority: number }[];
  payoff: null | {
    monthly_budget: number; avalanche: PayoffRun; snowball: PayoffRun; minimum_only: PayoffRun;
    interest_saved_vs_minimum: number; assumptions: string[];
  };
  disclaimer: string;
}
export const analyzeCredit = (body: CreditRequest) =>
  api.post<CreditResult>("/credit/analyze", body).then((r) => r.data);

export interface WhatIfResult {
  extra_payment: number; applied: number; unused: number;
  allocation: { card: string; paid: number }[];
  utilization_before_pct: number | null; utilization_after_pct: number | null;
  under_30_after: boolean; under_10_after: boolean;
  months_before: number; months_after: number;
  interest_before: number; interest_after: number; interest_saved: number;
  note: string;
}
export const creditWhatIf = (request: CreditRequest, extra_payment: number) =>
  api.post<WhatIfResult>("/credit/what-if", { request, extra_payment }).then((r) => r.data);

export interface CreditSnapshotPoint {
  id: number; created_at: string | null; score: number | null;
  utilization_pct: number | null; dti_pct: number | null;
  total_balance: number; total_limit: number;
}
export const saveCreditSnapshot = (body: CreditRequest) =>
  api.post<CreditSnapshotPoint>("/credit/snapshots", body).then((r) => r.data);
export const listCreditSnapshots = () =>
  api.get<CreditSnapshotPoint[]>("/credit/snapshots").then((r) => r.data);
export const latestCreditSnapshot = () =>
  api.get<(CreditSnapshotPoint & { inputs: CreditRequest }) | null>("/credit/snapshots/latest").then((r) => r.data);
export const deleteCreditSnapshot = (id: number) => api.delete(`/credit/snapshots/${id}`);

export interface Prefs { email_alerts: boolean; email_configured: boolean }
export const getPrefs = () => api.get<Prefs>("/me/preferences").then((r) => r.data);
export const setPrefs = (email_alerts: boolean) =>
  api.put<Prefs>("/me/preferences", { email_alerts }).then((r) => r.data);

// ---- Dashboard ----
export interface HealthComponent { key: string; label: string; points: number; max: number; value: number | string | null; note: string }
export interface Health {
  score: number; band: string; components: HealthComponent[];
  metrics: { emergency_months: number | null; dti_pct: number | null; savings_rate_pct: number | null; monthly_surplus: number };
}
export interface Alert { id: string; severity: "info" | "warning"; title: string; detail: string }
export interface Dashboard {
  has_twin: boolean; health: Health | null; alerts: Alert[];
  goals_total: number; net_worth: number | null; version_id: number | null;
}
export const getDashboard = () => api.get<Dashboard>("/dashboard").then((r) => r.data);

// ---- Planners ----
export interface Explained<T> { result: T; explanation: string; source: "ai" | "template" }

export interface StepUpInput { current_corpus: number; monthly_sip: number; step_up_pct: number; annual_return_pct: number; years: number }
export interface StepUpResult {
  series: { year: number; flat: number; step_up: number; invested_flat: number; invested_step_up: number }[];
  final_flat: number; final_step_up: number; invested_flat: number; invested_step_up: number;
  extra_wealth: number; final_year_sip: number;
}
export const planStepUp = (b: StepUpInput) =>
  api.post<Explained<StepUpResult>>("/planners/stepup", b).then((r) => r.data);

export interface RetirementInput {
  current_age: number; retirement_age: number; life_expectancy: number; monthly_expenses: number;
  inflation_pct: number; pre_return_pct: number; post_return_pct: number;
  current_corpus: number; monthly_sip: number; step_up_pct: number;
}
export interface RetirementResult {
  years_to_retirement: number; retirement_years: number; expenses_at_retirement_monthly: number;
  corpus_needed: number; projected_corpus: number; gap: number; on_track: boolean;
  required_monthly_sip: number; depletion_age: number | null; fire_number_today: number;
  series: { age: number; corpus: number; phase: "saving" | "retired" }[];
}
export const planRetirement = (b: RetirementInput) =>
  api.post<Explained<RetirementResult>>("/planners/retirement", b).then((r) => r.data);

export interface LoanInput {
  principal: number; annual_rate_pct: number; remaining_months: number; emi: number | null;
  lump_sum: number; extra_monthly: number; invest_return_pct: number;
}
export interface LoanRun { final_net_worth: number; interest_paid: number; loan_closed_month: number | null; investments: number; loan_balance: number }
export interface LoanResult {
  emi: number; prepay: LoanRun; invest: LoanRun; winner: "prepay" | "invest";
  difference: number; interest_saved: number; breakeven_return: number | null;
}
export const planLoan = (b: LoanInput) =>
  api.post<Explained<LoanResult>>("/planners/loan-vs-invest", b).then((r) => r.data);

// ---- Goal risk (Monte Carlo) ----
export interface GoalRisk {
  goal_id: number; name: string; probability_pct: number; inflated_target: number;
  p10: number; p50: number; p90: number; paths: number; volatility: number;
  fan: { month: number; p10: number; p50: number; p90: number }[];
  explanation: string; source: "ai" | "template";
}
export const goalRisk = (id: number, volatility: number) =>
  api.get<GoalRisk>(`/goals/${id}/risk`, { params: { volatility } }).then((r) => r.data);

// ---- Explain a scenario ----
export const explainScenario = (twin: Twin, scenarios: Scenario[]) =>
  api.post<{ explanation: string; source: "ai" | "template" }>("/explain/scenario", { twin, scenarios }).then((r) => r.data);

// ---- Tutor ----
export type TutorTerm = "xirr" | "sip_step_up" | "expense_ratio" | "inflation" | "emergency_fund" | "compounding";
export const tutor = (term: TutorTerm) =>
  api.post<{ term: TutorTerm; definition: string; explanation: string; source: "ai" | "template" }>("/ai/tutor", { term }).then((r) => r.data);

// ---- Statement import + spending insights ----
export interface Txn { date: string; description: string; amount: number; type: "debit" | "credit"; category: string }
export const parseBankFile = (file: File, password?: string) => {
  const f = new FormData();
  f.append("file", file);
  if (password) f.append("password", password);
  return api.post<{ transactions: Txn[]; count: number }>("/parse/bank-file", f).then((r) => r.data);
};
export interface InsightFacts {
  months: string[]; latest_month?: string; previous_month?: string | null;
  spend_by_month?: Record<string, number>; income_latest_month?: number;
  top_categories?: { category: string; total: number; share_pct: number }[];
  changes?: { category: string; previous: number; latest: number; change: number; change_pct: number | null }[];
  savings_rate_latest_pct?: number | null; skipped_rows: number;
}
export const spendingInsights = (transactions: Txn[]) =>
  api.post<{ facts: InsightFacts; explanation: string; source: "ai" | "template" }>("/ai/insights", { transactions }).then((r) => r.data);

// ---- CAS import (review before saving) ----
export interface CasHolding {
  isin: string; folio: string | null; units: number | null; cost: number | null; nav: number | null;
  confidence: number; needs_review: boolean;
}
export const parseCas = (file: File, password?: string) => {
  const f = new FormData();
  f.append("file", file);
  if (password) f.append("password", password);
  return api.post<{ holdings: CasHolding[] }>("/parse/cas", f).then((r) => r.data.holdings);
};
export interface HoldingIn { isin: string; folio?: string | null; name?: string | null; units?: number | null; nav?: number | null; cost?: number | null }
export const importHoldings = (holdings: HoldingIn[]) =>
  api.post<{ version_id: number; net_worth: number; imported: number }>("/twin/import-holdings", { holdings }).then((r) => r.data);

// ---- Share ----
export interface SharedScenario {
  title: string; twin: Twin; scenarios: Scenario[]; explanation: string; created_at: string;
  baseline: { name: string; final_corpus: number; series: { month: number; corpus: number }[] };
  results: { name: string; final_corpus: number; series: { month: number; corpus: number }[] }[];
}
export const createShare = (title: string, twin: Twin, scenarios: Scenario[]) =>
  api.post<{ token: string; path: string }>("/share", { title, twin, scenarios }).then((r) => r.data);
export const getShare = (token: string) => api.get<SharedScenario>(`/share/${token}`).then((r) => r.data);
