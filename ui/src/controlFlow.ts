import type { AgentId } from "../../packages/shared";

export type { AgentId } from "../../packages/shared";

export type ApiSession = { id: string; state?: string };

export interface SessionDraft {
  goal: string;
  verificationCommand: string;
  workspaceDir: string;
  initialAgent: AgentId;
}

export interface AgentModels {
  claude: string;
  codex: string;
}

export interface RelayApi {
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}

export function otherAgent(agent: AgentId): AgentId {
  return agent === "claude" ? "codex" : "claude";
}

export function agentLabel(agent: AgentId): string {
  return agent === "claude" ? "Claude" : "Codex";
}

export function createSessionBody(draft: SessionDraft): Record<string, unknown> {
  return {
    goal: draft.goal,
    verificationCommand: draft.verificationCommand,
    workspaceDir: draft.workspaceDir,
    sourceAgent: draft.initialAgent,
    targetAgent: otherAgent(draft.initialAgent),
  };
}

export function modelFor(agent: AgentId, models: AgentModels): string {
  return agent === "claude" ? models.claude : models.codex;
}

export async function createSession(
  api: RelayApi,
  draft: SessionDraft
): Promise<string> {
  const session = await api.requestJson<ApiSession>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(createSessionBody(draft)),
  });
  return session.id;
}

export async function switchAgent(
  api: RelayApi,
  opts: {
    sessionId: string;
    initialAgent: AgentId;
    target: AgentId;
    models: AgentModels;
    prompt: string;
    apiKeys?: { claude?: string; codex?: string };
  }
): Promise<void> {
  const keyFor = (agent: AgentId): string | undefined => {
    const k = agent === "claude" ? opts.apiKeys?.claude : opts.apiKeys?.codex;
    return k && k.trim() ? k.trim() : undefined;
  };
  const session = await api.requestJson<ApiSession>(
    `/api/sessions/${opts.sessionId}`
  );
  if (session.state === "created") {
    await api.requestJson(`/api/sessions/${opts.sessionId}/${opts.initialAgent}/start`, {
      method: "POST",
      body: JSON.stringify({
        model: modelFor(opts.initialAgent, opts.models),
        prompt: opts.prompt,
        apiKey: keyFor(opts.initialAgent),
      }),
    });
  }

  const latest = await api.requestJson<ApiSession>(
    `/api/sessions/${opts.sessionId}`
  );
  if (latest.state !== "handoff_ready") {
    await api.requestJson(`/api/sessions/${opts.sessionId}/handoff`, {
      method: "POST",
      body: "{}",
    });
  }

  await api.requestJson(`/api/sessions/${opts.sessionId}/${opts.target}/start`, {
    method: "POST",
    body: JSON.stringify({
      model: modelFor(opts.target, opts.models),
      prompt: opts.prompt,
      apiKey: keyFor(opts.target),
    }),
  });
}
