export type SenderType = "vip" | "customer" | "operations" | "monitoring" | "ticketing" | "internal" | "unknown";
export type Severity = "P1" | "P2" | "P3" | "P4" | "NON_INCIDENT";
export type IncidentState = "FOCUS_REQUIRED" | "ADDRESSED" | "AWAITING_CUSTOMER" | "ESCALATE_L2" | "WATCH" | "NON_INCIDENT";

export interface EmailMessage {
  messageId: string;
  subject: string;
  body: string;
  sender: string;
  senderType?: SenderType;
  receivedAt?: string;
  conversationId?: string;
  importance?: "low" | "normal" | "high" | string;
  categories?: string[];
  metadata?: Record<string, unknown>;
}

export interface IncidentSignal {
  source: string;
  name: string;
  weight: number;
  evidence: string;
}

export interface AgentContext {
  email: EmailMessage;
  signals: IncidentSignal[];
  isIncident?: boolean;
  incidentId?: string;
  severity?: Severity;
  category?: string;
  owner?: string;
  businessImpact?: string;
  state?: IncidentState;
  confidence?: number;
  summary?: string;
  nextAction?: string;
  audit: string[];
}

export interface Agent<I = AgentContext, O = AgentContext> {
  name: string;
  run(input: I): Promise<O>;
}

export interface DetectionResult {
  isIncident: boolean;
  incidentId?: string;
  severity: Severity;
  category: string;
  owner: string;
  state: IncidentState;
  confidence: number;
  businessImpact: string;
  summary: string;
  nextAction: string;
  signals: IncidentSignal[];
  audit: string[];
}
