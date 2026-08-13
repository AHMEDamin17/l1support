import { env, envBool } from "../utils/env.js";

export interface SlmJsonOptions {
  system: string;
  prompt: string;
  schemaHint: string;
}

export class SlmClient {
  readonly enabled = envBool("SLM_ENABLED", false);
  readonly baseUrl = env("SLM_BASE_URL", "http://localhost:11434/v1").replace(/\/$/, "");
  readonly apiKey = env("SLM_API_KEY", "ollama");
  readonly model = env("SLM_MODEL", "phi3:mini");
  readonly timeoutMs = Number(env("SLM_TIMEOUT_MS", "15000"));

  async completeJson<T>(options: SlmJsonOptions): Promise<T | null> {
    if (!this.enabled) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: options.system },
            { role: "user", content: `${options.prompt}\n\nReturn JSON only. Schema hint:\n${options.schemaHint}` }
          ]
        })
      });
      if (!response.ok) return null;
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      return JSON.parse(content) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
