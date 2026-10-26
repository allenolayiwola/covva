/**
 * Insurer connector framework (Addendum 2 A, Level 3) and the NIC motor insurance database
 * registration adapter (Level 2). One adapter per insurer behind a common interface; the
 * `simulator` adapter is the only implementation for now and never talks to a real system.
 *
 * Pure TypeScript: no network, no database. Server code (`apps/web/src/server/issuance.ts`)
 * picks an adapter by `insurer_line_integrations.level` / the insurer's connector settings and
 * records the results on `issuance_jobs`.
 */

export interface ConnectorRisk {
  categorySlug: string;
  risk: Record<string, unknown>;
  customer?: { fullName?: string | null; phone?: string | null; email?: string | null };
}

export interface ConnectorQuoteRequest extends ConnectorRisk {
  productCode?: string | null;
  sumInsured?: number | null;
  currency?: string;
}

export interface ConnectorQuote {
  ok: true;
  externalReference: string;
  premium: number;
  currency: string;
  validUntil: string;
  excess?: number | null;
  terms?: Record<string, unknown>;
}

export interface ConnectorBindRequest {
  externalReference: string;
  coverStart: string;
  coverEnd: string;
  paymentReference?: string | null;
}

export interface ConnectorBind {
  ok: true;
  externalReference: string;
  bound: boolean;
}

export interface ConnectorIssueRequest extends ConnectorBindRequest {
  policyId: string;
  customer: { fullName: string; phone?: string | null; email?: string | null };
  risk: Record<string, unknown>;
}

export interface ConnectorIssue {
  ok: true;
  policyNumber: string;
  externalReference: string;
  issuedAt: string;
  /** Documents the insurer's system produced (URLs or base64 PDFs); empty when Covva renders them. */
  documents: { kind: "schedule" | "certificate" | "sticker" | "receipt"; url?: string; base64?: string }[];
}

export interface ConnectorFailure {
  ok: false;
  code: "unavailable" | "rejected" | "invalid" | "not_implemented";
  message: string;
  retryable: boolean;
}

export type ConnectorResult<T> = T | ConnectorFailure;

export interface MotorRegistrationRequest {
  policyId: string;
  policyNumber: string;
  insurerName: string;
  insurerNicLicence?: string | null;
  vehicleRegistration?: string | null;
  chassisNumber?: string | null;
  coverStart: string;
  coverEnd: string;
  stickerNumber?: string | null;
}

export interface MotorRegistration {
  ok: true;
  /** `registered` when the database confirmed it; `pending` when handed off for manual entry. */
  status: "registered" | "pending";
  reference: string | null;
  provider: string;
  submittedAt: string;
}

/** Common interface every insurer adapter implements (Addendum 2 A, Level 3). */
export interface InsurerConnector {
  readonly id: string;
  readonly name: string;
  quote(input: ConnectorQuoteRequest): Promise<ConnectorResult<ConnectorQuote>>;
  bind(input: ConnectorBindRequest): Promise<ConnectorResult<ConnectorBind>>;
  issue(input: ConnectorIssueRequest): Promise<ConnectorResult<ConnectorIssue>>;
  registerMotor(input: MotorRegistrationRequest): Promise<ConnectorResult<MotorRegistration>>;
}

/** How motor policies reach the NIC motor insurance database (`NIC_MOTOR_DB_MODE`). */
export type NicMotorDbMode = "manual" | "api";
export const NIC_MOTOR_DB_MODES: NicMotorDbMode[] = ["manual", "api"];

export function parseNicMotorDbMode(value: string | null | undefined): NicMotorDbMode {
  return value === "api" ? "api" : "manual";
}

/** NIC motor database registration adapter: either an API client or a hand-off to the insurer. */
export interface NicMotorRegistrationAdapter {
  readonly mode: NicMotorDbMode;
  readonly provider: string;
  register(input: MotorRegistrationRequest): Promise<ConnectorResult<MotorRegistration>>;
}

export const notImplemented = (what: string): ConnectorFailure => ({ ok: false, code: "not_implemented", message: `${what} is not available for this insurer yet.`, retryable: false });

/** Stable pseudo-random reference derived from the input (so the simulator is deterministic in tests). */
function hashRef(prefix: string, seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${prefix}-${h.toString(36).toUpperCase().padStart(7, "0")}`;
}

export interface SimulatorOptions {
  /** Fixed clock for deterministic output in tests. */
  now?: () => Date;
  /** Premium per 1 of sum insured when the risk carries one (default 4%). */
  rate?: number;
  /** Reject risks whose `risk.simulate` equals this value (default "decline"). */
  declineMarker?: string;
}

/**
 * Simulator adapter: answers instantly with plausible values and never contacts anyone.
 * Used in development and e2e; a real adapter implements the same interface per insurer.
 */
export function simulatorConnector(opts: SimulatorOptions = {}): InsurerConnector {
  const now = opts.now ?? (() => new Date());
  const rate = opts.rate ?? 0.04;
  const marker = opts.declineMarker ?? "decline";
  const rejects = (risk: Record<string, unknown>) => String(risk.simulate ?? "").toLowerCase() === marker;
  return {
    id: "simulator",
    name: "Simulator (no real insurer)",
    async quote(input) {
      if (rejects(input.risk)) return { ok: false, code: "rejected", message: "Simulated decline: outside appetite.", retryable: false };
      const sum = Number(input.sumInsured ?? input.risk.sum_insured ?? input.risk.vehicle_value ?? 0);
      const premium = Math.max(100, Math.round(sum * rate * 100) / 100);
      const at = now();
      return {
        ok: true,
        externalReference: hashRef("SIM-Q", JSON.stringify({ c: input.categorySlug, r: input.risk, p: input.productCode ?? null })),
        premium,
        currency: input.currency ?? "GHS",
        validUntil: new Date(at.getTime() + 14 * 86_400_000).toISOString(),
        excess: Math.round(premium * 0.1),
        terms: { simulated: true },
      };
    },
    async bind(input) {
      if (!input.externalReference) return { ok: false, code: "invalid", message: "A quote reference is required to bind.", retryable: false };
      if (input.coverEnd <= input.coverStart) return { ok: false, code: "invalid", message: "Cover end must be after cover start.", retryable: false };
      return { ok: true, externalReference: input.externalReference, bound: true };
    },
    async issue(input) {
      if (rejects(input.risk)) return { ok: false, code: "rejected", message: "Simulated decline at issuance.", retryable: false };
      if (input.coverEnd <= input.coverStart) return { ok: false, code: "invalid", message: "Cover end must be after cover start.", retryable: false };
      return {
        ok: true,
        policyNumber: hashRef("SIM", input.policyId),
        externalReference: input.externalReference || hashRef("SIM-Q", input.policyId),
        issuedAt: now().toISOString(),
        documents: [],
      };
    },
    async registerMotor(input) {
      if (!input.policyNumber) return { ok: false, code: "invalid", message: "A policy number is required to register a motor policy.", retryable: false };
      return { ok: true, status: "registered", reference: hashRef("NIC-SIM", input.policyNumber), provider: "simulator", submittedAt: now().toISOString() };
    },
  };
}

/**
 * Manual hand-off: the insurer registers the policy on the NIC motor database themselves.
 * `register` only reports `pending`; the server creates an insurer task and the insurer marks
 * it registered (with the NIC reference) from the delegated-issuance queue.
 */
export function manualHandoffMotorRegistration(now: () => Date = () => new Date()): NicMotorRegistrationAdapter {
  return {
    mode: "manual",
    provider: "manual_handoff",
    async register(input) {
      if (!input.policyNumber) return { ok: false, code: "invalid", message: "A policy number is required before the NIC hand-off.", retryable: false };
      return { ok: true, status: "pending", reference: null, provider: "manual_handoff", submittedAt: now().toISOString() };
    },
  };
}

/** API mode delegates to the insurer's connector (`registerMotor`); the simulator is the only one today. */
export function apiMotorRegistration(connector: InsurerConnector): NicMotorRegistrationAdapter {
  return {
    mode: "api",
    provider: connector.id,
    register: (input) => connector.registerMotor(input),
  };
}

/** Picks the motor-registration adapter for the configured mode. */
export function nicMotorRegistration(mode: NicMotorDbMode, connector?: InsurerConnector | null): NicMotorRegistrationAdapter {
  return mode === "api" && connector ? apiMotorRegistration(connector) : manualHandoffMotorRegistration();
}

/** Registry of adapters by id. Only the simulator exists; real adapters register here. */
export function connectorFor(id: string | null | undefined): InsurerConnector | null {
  switch ((id ?? "").toLowerCase()) {
    case "simulator":
    case "sim":
      return simulatorConnector();
    default:
      return null;
  }
}
