import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
});

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

export const simulate = (twin: Twin, scenarios: Scenario[]) =>
  api.post<SimResponse>("/simulate", { twin, scenarios }).then((r) => r.data);

export const parseIntent = (query: string) =>
  api
    .post<{ refused: boolean; message: string; scenario: Scenario | null }>("/ai/intent", { query })
    .then((r) => r.data);

export const explain = (query: string) =>
  api.post<{ explanation: string }>("/ai/explain", { query }).then((r) => r.data.explanation);
