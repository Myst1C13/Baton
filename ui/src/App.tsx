import { useEffect, useRef, useState, type ReactNode } from "react";
import { demoEvents, demoPacket } from "./demo";
import { useRelayStream } from "./useRelayStream";
import {
  activeAgent,
  derivePhase,
  eventLine,
  migrationState,
  packetReady,
  type Line,
  type Phase,
} from "./live";
import {
  agentLabel,
  createSession as createRelaySession,
  createSessionBody,
  modelFor,
  otherAgent,
  switchAgent as switchRelayAgent,
  type AgentId,
  type ApiSession,
  type RelayApi,
} from "./controlFlow";

type IconName = "arrow" | "check" | "cross" | "spark" | "shield" | "file";

const icons: Record<IconName, ReactNode> = {
  arrow: <path d="M5 12h13m-5-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  spark: <path d="m12 3 1.2 5L18 9l-4.8 1L12 15l-1.2-5L6 9l4.8-1z" />,
  shield: (
    <>
      <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
    </>
  ),
};

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

// Claude works the bug, then hits a usage limit with the test still failing.
const claudeLines: Line[] = [
  { kind: "muted", value: "Last login: Sun Jun 21 00:14 on ttys002" },
  { kind: "prompt", value: '$ claude "make the users.age migration safe to re-run"' },
  { kind: "plain", value: "● reading relay-mock/migrate.ts" },
  { kind: "plain", value: "● editing relay-mock/migrate.ts  +18" },
  { kind: "prompt", value: "$ npm test -- migration" },
  { kind: "pass", value: "✔ shared schemas validate packet defaults" },
  { kind: "fail", value: "✖ migration remains safe when re-run" },
  { kind: "muted", value: "  SQLITE_ERROR: duplicate column name: age" },
  { kind: "fail", value: "✖ claude: API error 429 — usage limit reached" },
];

// After the handoff, Codex resumes from the packet and finishes the job.
const codexLines: Line[] = [
  { kind: "relay", value: "↪ relay: freezing workspace · 2 files · 37 lines" },
  { kind: "relay", value: "↪ relay: handoff packet ready · −93% · 1,218 tokens" },
  { kind: "prompt", value: "$ codex resume --packet relay-7f3a.json" },
  { kind: "plain", value: "● failure memory loaded — don't retry ALTER blindly" },
  { kind: "plain", value: "● guarding schema with PRAGMA table_info(users)" },
  { kind: "prompt", value: "$ npm test -- migration" },
  { kind: "pass", value: "✔ migration remains safe when re-run" },
  { kind: "pass", value: "✔ existing user rows remain unchanged" },
  { kind: "prompt", value: "$ npm test && npm run typecheck" },
  { kind: "pass", value: "✔ all checks passed" },
];

function Terminal({ lines, phase }: { lines: Line[]; phase: Phase }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className="terminal" aria-label="Live terminal">
      <header className="terminal-bar">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <span className="terminal-title">relay — zsh</span>
        <span className="terminal-branch">syed/control-tower-ui</span>
      </header>
      <div className="terminal-body" ref={bodyRef}>
        {lines.map((line, i) => (
          <div className={`line ${line.kind}`} key={i}>
            {line.value || " "}
          </div>
        ))}
        {phase !== "switching" && <span className="cursor" />}
      </div>
    </section>
  );
}

function Rail({
  phase,
  handoffDone,
  onSwitch,
  live = false,
  agentName,
  migration,
  sessionLabel = "session 7f3a",
  controls,
}: {
  phase: Phase;
  handoffDone: boolean;
  onSwitch: () => void;
  live?: boolean;
  agentName?: "claude" | "codex";
  migration?: "pass" | "fail" | "pending";
  sessionLabel?: string;
  controls?: ReactNode;
}) {
  const isCodex = agentName ? agentName === "codex" : phase === "resumed";
  const agent = isCodex
    ? { name: "Codex", model: "GPT-5", letter: "X", tone: "codex" }
    : { name: "Claude", model: "Opus 4.8", letter: "C", tone: "claude" };

  const status =
    phase === "switching"
      ? "relaying context…"
      : phase === "resumed"
        ? "resumed · working"
        : live
          ? "running"
          : "usage limit reached";

  // Verification: explicit override in live mode, else derived from phase.
  const migrationOk = migration ? migration === "pass" : phase === "resumed";

  return (
    <aside className="rail" aria-label="Relay">
      <header className="rail-head">
        <span className="dot" />
        <strong>Relay</strong>
        <span className="session">{sessionLabel}</span>
      </header>

      <div className="rail-body">
        <div className="agent">
          <span className={`glyph ${agent.tone} ${phase}`}>{agent.letter}</span>
          <div>
            <small>ACTIVE AGENT</small>
            <strong>{agent.name}</strong>
            <span className={`status ${phase}`}>{status}</span>
          </div>
        </div>

        <div className="block">
          <small>TASK</small>
          <p>{demoPacket.task.goal}</p>
        </div>

        <div className={`packet ${handoffDone ? "shown" : ""}`}>
          <div className="packet-top">
            <span>
              Claude <Icon name="arrow" size={12} /> Codex
            </span>
            <b>−93%</b>
          </div>
          <div className="packet-meta">
            <span>
              <Icon name="file" size={12} /> 2 files
            </span>
            <span>
              <Icon name="spark" size={12} /> 1,218 tok
            </span>
            <span>
              <Icon name="shield" size={12} /> memory kept
            </span>
          </div>
        </div>

        <div className="block verify">
          <small>VERIFICATION</small>
          <div className="check">
            <span className="ok">
              <Icon name="check" size={12} />
            </span>
            TypeScript
          </div>
          <div className="check">
            <span className={migrationOk ? "ok" : "bad"}>
              <Icon name={migrationOk ? "check" : "cross"} size={12} />
            </span>
            Migration test
          </div>
        </div>

        {controls}
      </div>

      {!live && (
        <footer className="rail-foot">
          <button className="switch" onClick={onSwitch} disabled={phase !== "working"}>
            {phase === "working" && (
              <>
                <Icon name="spark" size={14} /> Run demo handoff
              </>
            )}
            {phase === "switching" && (
              <>
                <span className="spinner" /> Relaying…
              </>
            )}
            {phase === "resumed" && (
              <>
                <Icon name="check" size={14} /> Handoff complete
              </>
            )}
          </button>
        </footer>
      )}
    </aside>
  );
}

// ?live=<sessionId>&ws=<wsBase> switches the UI to the real broadcaster.
function liveConfig(): { sessionId: string | null; base: string; api: string } {
  if (typeof window === "undefined") {
    return {
      sessionId: null,
      base: "ws://127.0.0.1:4000",
      api: "http://127.0.0.1:4000",
    };
  }
  const params = new URLSearchParams(window.location.search);
  const base = params.get("ws") ?? "ws://127.0.0.1:4000";
  return {
    sessionId: params.get("live"),
    base,
    api: params.get("api") ?? base.replace(/^ws/i, "http"),
  };
}

async function requestJson<T>(
  apiBase: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      data?.error?.message ?? data?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

function updateLiveUrl(sessionId: string, base: string, api: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("live", sessionId);
  url.searchParams.set("ws", base);
  url.searchParams.set("api", api);
  window.history.replaceState(null, "", url);
}

export function App() {
  const config = liveConfig();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(config.sessionId);
  const [wsBase] = useState(config.base);
  const [apiBase, setApiBase] = useState(config.api);
  const [goal, setGoal] = useState(demoPacket.task.goal);
  const [verificationCommand, setVerificationCommand] = useState("npm test");
  const [workspaceDir, setWorkspaceDir] = useState("demo-repo");
  const [prompt, setPrompt] = useState("Fix the migration bug. Run the tests.");
  const [inputText, setInputText] = useState("");
  const [initialAgent, setInitialAgent] = useState<AgentId>("claude");
  const [claudeModel, setClaudeModel] = useState("claude-sonnet-4-6");
  const [codexModel, setCodexModel] = useState("gpt-5-codex");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [controlMessage, setControlMessage] = useState("");
  const isLive = currentSessionId !== null;

  // Live mode: events come from the server broadcaster.
  const { events, status } = useRelayStream(currentSessionId, wsBase);

  // Demo mode: scripted Claude → Codex handoff (works offline).
  const [demoPhase, setDemoPhase] = useState<Phase>("working");
  const [demoLines, setDemoLines] = useState<Line[]>(claudeLines);

  function runHandoff() {
    if (demoPhase !== "working") return;
    setDemoPhase("switching");
    codexLines.forEach((line, i) => {
      window.setTimeout(() => {
        setDemoLines((prev) => [...prev, line]);
        if (i === codexLines.length - 1) setDemoPhase("resumed");
      }, 450 * (i + 1));
    });
  }

  async function runControl(action: string, work: () => Promise<void>): Promise<void> {
    setPendingAction(action);
    setControlMessage("");
    try {
      await work();
    } catch (err) {
      setControlMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  const api: RelayApi = {
    requestJson: (path, init) => requestJson(apiBase, path, init),
  };

  async function createSessionRequest(): Promise<string> {
    const sessionId = await createRelaySession(api, {
        goal,
        verificationCommand,
        workspaceDir,
        initialAgent,
    });
    setCurrentSessionId(sessionId);
    updateLiveUrl(sessionId, wsBase, apiBase);
    return sessionId;
  }

  async function createLiveSession(): Promise<void> {
    await runControl("create", async () => {
      const sessionId = await createSessionRequest();
      setControlMessage(`session ${sessionId}`);
    });
  }

  async function ensureLiveSession(): Promise<string> {
    return currentSessionId ?? createSessionRequest();
  }

  async function sessionAction(
    action: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<void> {
    await runControl(action, async () => {
      const sessionId = await ensureLiveSession();
      await requestJson(apiBase, `/api/sessions/${sessionId}${path}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : "{}",
      });
      setControlMessage(action);
      if (action === "input") setInputText("");
    });
  }

  async function startAgent(agent: AgentId): Promise<void> {
    await sessionAction(`start ${agent}`, `/${agent}/start`, {
      model: modelFor(agent, { claude: claudeModel, codex: codexModel }),
      prompt,
    });
  }

  async function switchAgent(target: AgentId): Promise<void> {
    await runControl(`switch to ${target}`, async () => {
      const sessionId = await ensureLiveSession();
      await switchRelayAgent(api, {
        sessionId,
        initialAgent,
        target,
        models: { claude: claudeModel, codex: codexModel },
        prompt,
      });
      setControlMessage(`${target} running`);
    });
  }

  // Resolve what the panels render, from whichever mode is active.
  const liveLines: Line[] = events.length
    ? events.map(eventLine)
    : [
        {
          kind: "muted",
          value:
            status === "open"
              ? `connected · waiting for events on ${currentSessionId}…`
              : status === "error" || status === "closed"
                ? `broadcaster unavailable (${wsBase}) — start the server`
                : `connecting to ${wsBase}…`,
        },
      ];

  const phase: Phase = isLive ? derivePhase(events) : demoPhase;
  const lines = isLive ? liveLines : demoLines;
  const handoffDone = isLive ? packetReady(events) : demoPhase !== "working";
  const selectedActiveAgent = isLive && events.length ? activeAgent(events) : initialAgent;
  const switchTarget = otherAgent(selectedActiveAgent);
  const controls = (
    <div className="controls" aria-label="Session controls">
      <label className="field">
        <span>API</span>
        <input
          value={apiBase}
          onChange={(event) => setApiBase(event.target.value)}
          disabled={pendingAction !== null}
        />
      </label>
      <label className="field">
        <span>Workspace</span>
        <input
          value={workspaceDir}
          onChange={(event) => setWorkspaceDir(event.target.value)}
          disabled={isLive || pendingAction !== null}
        />
      </label>
      <label className="field">
        <span>Goal</span>
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          disabled={isLive || pendingAction !== null}
          rows={3}
        />
      </label>
      <label className="field">
        <span>Verify</span>
        <input
          value={verificationCommand}
          onChange={(event) => setVerificationCommand(event.target.value)}
          disabled={isLive || pendingAction !== null}
        />
      </label>
      <button
        className="action primary"
        onClick={createLiveSession}
        disabled={isLive || pendingAction !== null}
      >
        {pendingAction === "create" ? <span className="spinner" /> : <Icon name="spark" size={14} />}
        Create session
      </button>
      <label className="field">
        <span>Initial agent</span>
        <select
          value={initialAgent}
          onChange={(event) => setInitialAgent(event.target.value as AgentId)}
          disabled={isLive || pendingAction !== null}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <label className="field">
        <span>Claude model</span>
        <input
          value={claudeModel}
          onChange={(event) => setClaudeModel(event.target.value)}
          disabled={pendingAction !== null}
        />
      </label>
      <label className="field">
        <span>Prompt</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={pendingAction !== null}
          rows={3}
        />
      </label>
      <div className="action-grid">
        <button
          className="action"
          onClick={() => startAgent(initialAgent)}
          disabled={pendingAction !== null}
        >
          Start {agentLabel(initialAgent)}
        </button>
        <button
          className="action"
          onClick={() => switchAgent(switchTarget)}
          disabled={pendingAction !== null}
        >
          Switch to {agentLabel(switchTarget)}
        </button>
      </div>
      <label className="field">
        <span>Codex model</span>
        <input
          value={codexModel}
          onChange={(event) => setCodexModel(event.target.value)}
          disabled={pendingAction !== null}
        />
      </label>
      <button
        className="action"
        onClick={() => sessionAction("verify", "/verify")}
        disabled={!isLive || pendingAction !== null}
      >
        Verify
      </button>
      <label className="field">
        <span>Input</span>
        <textarea
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          disabled={!isLive || pendingAction !== null}
          rows={2}
        />
      </label>
      <button
        className="action"
        onClick={() => sessionAction("input", "/input", { data: `${inputText}\n` })}
        disabled={!isLive || pendingAction !== null || inputText.trim().length === 0}
      >
        Send input
      </button>
      {controlMessage && <div className="control-message">{controlMessage}</div>}
    </div>
  );

  return (
    <main className="shell">
      <div className="workspace">
        <Terminal lines={lines} phase={phase} />
        <Rail
          phase={phase}
          handoffDone={handoffDone}
          onSwitch={runHandoff}
          live={isLive}
          agentName={isLive ? activeAgent(events) : undefined}
          migration={isLive ? migrationState(events) : undefined}
          sessionLabel={isLive ? `session ${currentSessionId}` : "new session"}
          controls={controls}
        />
      </div>
      <footer className="note">
        <span>Quiet while healthy. Useful when an agent fails.</span>
        <span>
          {demoEvents.length} validated events · packet v{demoPacket.version}
        </span>
      </footer>
    </main>
  );
}
