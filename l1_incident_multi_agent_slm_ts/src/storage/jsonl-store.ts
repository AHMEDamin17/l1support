import fs from "node:fs";
import path from "node:path";
import type { DetectionResult, EmailMessage } from "../core/types.js";

export interface StoredIncident {
  email: EmailMessage;
  result: DetectionResult;
  createdAt: string;
}

export class JsonlIncidentStore {
  constructor(private readonly filePath = "data/incidents.jsonl") {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  save(email: EmailMessage, result: DetectionResult): void {
    if (!result.isIncident) return;
    const record: StoredIncident = { email, result, createdAt: new Date().toISOString() };
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf8");
  }

  list(limit = 100): StoredIncident[] {
    if (!fs.existsSync(this.filePath)) return [];
    const rows = fs.readFileSync(this.filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    return rows.slice(-limit).reverse().map(row => JSON.parse(row) as StoredIncident);
  }

  summary(): { total: number; bySeverity: Record<string, number>; byState: Record<string, number>; topFocus: StoredIncident[] } {
    const items = this.list(10000);
    const bySeverity: Record<string, number> = {};
    const byState: Record<string, number> = {};
    for (const item of items) {
      bySeverity[item.result.severity] = (bySeverity[item.result.severity] ?? 0) + 1;
      byState[item.result.state] = (byState[item.result.state] ?? 0) + 1;
    }
    const topFocus = items.filter(i => ["FOCUS_REQUIRED", "ESCALATE_L2"].includes(i.result.state)).slice(0, 10);
    return { total: items.length, bySeverity, byState, topFocus };
  }
}
