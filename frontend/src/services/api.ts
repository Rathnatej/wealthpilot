import axios from "axios";

const api = axios.create({
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

export const parseIntent = (query: string) =>
  api
    .post<{ refused: boolean; message: string; scenario: Scenario | null }>("/ai/intent", { query })
    .then((r) => r.data);

export const explain = (query: string) =>
  api.post<{ explanation: string }>("/ai/explain", { query }).then((r) => r.data.explanation);
