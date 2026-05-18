#!/usr/bin/env node
// cogx — CogX CLI. Pure Node.js, zero deps. Requires Node 18+.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { exec } = require("child_process");

if (typeof fetch !== "function") {
  console.error("cogx requires Node.js 18 or newer (no built-in fetch found).");
  process.exit(1);
}

const VERSION = "1.1.0";
const API_URL = (process.env.ICOG_API_URL || "https://i.cognitivx.io").replace(/\/$/, "");
const ICOG_DIR = path.join(os.homedir(), ".icog");
const CREDS_PATH = path.join(ICOG_DIR, "credentials.json");
const HISTORY_PATH = path.join(ICOG_DIR, "history");
const DEFAULT_TIMEOUT_MS = parseInt(process.env.ICOG_TIMEOUT_MS || "60000", 10);

// ---------------------------------------------------------------------------
// Output / colors
// ---------------------------------------------------------------------------

const TTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim:   (s) => TTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:  (s) => TTY ? `\x1b[1m${s}\x1b[0m` : s,
  italic:(s) => TTY ? `\x1b[3m${s}\x1b[0m` : s,
  under: (s) => TTY ? `\x1b[4m${s}\x1b[0m` : s,
  cyan:  (s) => TTY ? `\x1b[36m${s}\x1b[0m` : s,
  green: (s) => TTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:   (s) => TTY ? `\x1b[31m${s}\x1b[0m` : s,
  mag:   (s) => TTY ? `\x1b[35m${s}\x1b[0m` : s,
  gray:  (s) => TTY ? `\x1b[90m${s}\x1b[0m` : s,
  yellow:(s) => TTY ? `\x1b[33m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Markdown → ANSI renderer
// ---------------------------------------------------------------------------
//
// Minimal markdown styling for streamed model output. Zero-dependency: parses
// line by line with a few regex passes. Mirrors how claude-code and similar
// CLIs surface bold/italic/code/headings/lists in the terminal. Falls back to
// the raw string when stdout isn't a TTY (pipes, redirects).

const TERM_WIDTH = (process.stdout.columns && process.stdout.columns > 20)
  ? Math.min(process.stdout.columns, 100)
  : 80;

function inlineFmt(text) {
  // Agent / iCog exchange chip — render as a soft cyan pill at the start.
  // Matches [Agent:slug→iCog], [Agent→iCog], [iCog→Agent], [iCog→slug], [Agent], [iCog].
  text = text.replace(
    /^\[((?:Agent|iCog)(?::[^\]→]+)?(?:→[^\]]+)?)\]\s*/,
    (_, body) => c.cyan(c.bold("⟨" + body + "⟩")) + " ",
  );
  // Inline code: `code` → cyan, no backticks.
  text = text.replace(/`([^`\n]+)`/g, (_, body) => c.cyan(body));
  // Links: [label](url) → underlined cyan label. URL dropped for compactness.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label) => c.cyan(c.under(label)));
  // Bold **text** or __text__ — handled before italic so the inner * isn't eaten.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, (_, body) => c.bold(body));
  text = text.replace(/__([^_\n]+)__/g, (_, body) => c.bold(body));
  // Italic *text* or _text_ — only when flanked by whitespace/punctuation, so
  // we don't mangle identifiers like foo_bar_baz.
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, (_, pre, body) => pre + c.italic(body));
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, (_, pre, body) => pre + c.italic(body));
  return text;
}

function renderMarkdown(input) {
  if (!input || !TTY) return input || "";
  const lines = String(input).split("\n");
  const out = [];
  let inCodeBlock = false;
  for (const raw of lines) {
    const fence = raw.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      if (inCodeBlock) {
        out.push(c.gray("└" + "─".repeat(Math.max(8, TERM_WIDTH - 2))));
        inCodeBlock = false;
      } else {
        const lang = fence[1] || "code";
        out.push(c.gray("┌─ " + lang + " " + "─".repeat(Math.max(2, TERM_WIDTH - 5 - lang.length))));
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(c.gray("│ ") + c.dim(raw));
      continue;
    }
    const head = raw.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      const level = head[1].length;
      const body = inlineFmt(head[2]);
      out.push(level <= 2 ? c.bold(c.cyan(body)) : c.bold(body));
      continue;
    }
    if (/^\s*---+\s*$/.test(raw)) {
      out.push(c.gray("─".repeat(Math.max(8, Math.floor(TERM_WIDTH / 2)))));
      continue;
    }
    const quote = raw.match(/^>\s?(.*)$/);
    if (quote) {
      out.push(c.gray("│ ") + c.italic(c.dim(inlineFmt(quote[1]))));
      continue;
    }
    const ul = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      out.push(ul[1] + c.mag("•") + " " + inlineFmt(ul[2]));
      continue;
    }
    const ol = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ol) {
      out.push(ol[1] + c.mag(ol[2] + ".") + " " + inlineFmt(ol[3]));
      continue;
    }
    out.push(inlineFmt(raw));
  }
  return out.join("\n");
}

let JSON_MODE = false;
function out(human, jsonObj) {
  if (JSON_MODE) console.log(JSON.stringify(jsonObj));
  else console.log(human);
}
function die(msg, code = 1, extra = {}) {
  if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: msg, ...extra }));
  else console.error(c.red("error:") + " " + msg);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (["all", "deep", "force", "help", "json", "version"].includes(key)) flags[key] = true;
      else if (next !== undefined && !next.startsWith("-")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else if (a.startsWith("-") && a.length > 1) {
      const short = a.slice(1);
      const map = { t: "type", j: "json", h: "help", v: "version", p: "project", l: "limit" };
      const key = map[short] || short;
      const next = argv[i + 1];
      if (key === "json" || key === "help" || key === "version") flags[key] = true;
      else if (next !== undefined && !next.startsWith("-")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function loadCreds() {
  try { return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")); } catch { return {}; }
}

function saveCreds(creds) {
  fs.mkdirSync(ICOG_DIR, { recursive: true });
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

// Set by --api-key CLI flag at dispatch time. Highest precedence.
let API_KEY_OVERRIDE = "";

function getApiKey() {
  if (API_KEY_OVERRIDE) return API_KEY_OVERRIDE;
  if (process.env.ICOG_API_KEY) return process.env.ICOG_API_KEY;
  const k = loadCreds().api_key;
  if (!k) die("not authenticated. Run: cogx auth login  (or set ICOG_API_KEY, or pass --api-key)");
  return k;
}

// ---------------------------------------------------------------------------
// stdin
// ---------------------------------------------------------------------------

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
    process.stdin.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// HTTP client with retry + timeout
// ---------------------------------------------------------------------------

const TRANSIENT_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 3000, 8000];

async function httpRequest(method, route, { body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS, retries = true } = {}) {
  const url = API_URL + route;
  const headers = { "Content-Type": "application/json", "User-Agent": `cogx/${VERSION}` };
  if (auth) headers["X-API-Key"] = getApiKey();
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const attempts = retries ? RETRY_DELAYS_MS.length + 1 : 1;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (TRANSIENT_STATUS.has(r.status) && i < attempts - 1) {
        await sleep(RETRY_DELAYS_MS[i]);
        continue;
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const detail = text ? `: ${text.slice(0, 300)}` : "";
        const err = new Error(`HTTP ${r.status} ${r.statusText}${detail}`);
        err.status = r.status;
        throw err;
      }
      const ct = r.headers.get("content-type") || "";
      return ct.includes("application/json") ? r.json() : r.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const isNetwork = e.name === "AbortError" || e.code === "ECONNRESET" || e.code === "ETIMEDOUT" || e.code === "ENOTFOUND" || /fetch failed/i.test(e.message);
      if (isNetwork && i < attempts - 1) {
        await sleep(RETRY_DELAYS_MS[i]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

// Consume a Server-Sent-Events stream. Calls onEvent({event, data}) for each
// dispatched message. Resolves when the stream ends. No retries — deep
// recall/remember is interactive and a failure should surface immediately.
async function httpStream(method, route, { body, onEvent, timeoutMs = 120000 } = {}) {
  const url = API_URL + route;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "User-Agent": `cogx/${VERSION}`,
    "X-API-Key": getApiKey(),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  if (!r.ok) {
    clearTimeout(timer);
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText}${text ? ": " + text.slice(0, 300) : ""}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let evName = "message";
  let dataLines = [];
  const dispatch = () => {
    if (!dataLines.length) { evName = "message"; return; }
    const data = dataLines.join("\n");
    try { onEvent({ event: evName, data: JSON.parse(data) }); }
    catch { onEvent({ event: evName, data }); }
    evName = "message";
    dataLines = [];
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") { dispatch(); continue; }
        if (line.startsWith(":")) continue;
        const sep = line.indexOf(":");
        const field = sep < 0 ? line : line.slice(0, sep);
        const val = sep < 0 ? "" : line.slice(sep + 1).replace(/^ /, "");
        if (field === "event") evName = val;
        else if (field === "data") dataLines.push(val);
      }
    }
    dispatch();
  } finally {
    clearTimeout(timer);
  }
}

// Render a single deep-memory event to the terminal as one line in a
// vertical chain. Indentation + glyphs match the on-brand style used by the
// chat UI's DeepMemoryChain component.
function renderChainEvent(ev) {
  const k = ev.kind;
  if (k === "start") {
    console.log(c.mag("⌁") + " " + c.bold("deep memory"));
    console.log(c.gray("│"));
    return;
  }
  if (k === "plan") {
    const qs = (ev.queries || []).map((q) => `"${q}"`).join(", ");
    console.log(c.mag("◇") + " " + c.bold("plan") + c.gray("  " + qs));
    console.log(c.gray("│"));
    return;
  }
  if (k === "search") {
    const q = (ev.query || "").slice(0, 80);
    const hits = ev.hits != null ? `  ${c.dim(ev.hits + " hits")}` : "";
    console.log(c.cyan("◯") + ` ${c.gray("search")}  "${q}"${hits}`);
    console.log(c.gray("│"));
    return;
  }
  if (k === "reflect") {
    const arrow = ev.action === "continue" ? c.yellow("↻") : c.green("✓");
    const label = ev.action === "continue" ? "another angle" : "coverage sufficient";
    console.log(`${arrow} ${c.gray("reflect")}  ${c.dim(label + (ev.reason ? " — " + ev.reason : ""))}`);
    console.log(c.gray("│"));
    return;
  }
  if (k === "synthesize") {
    console.log(c.mag("✦") + " " + c.gray("synthesize") + c.dim("  " + (ev.candidates || 0) + " candidates"));
    console.log(c.gray("│"));
    return;
  }
  if (k === "classify") {
    const label = { write_new: "new memory", skip_duplicate: "duplicate found", refine: "refinement" }[ev.action] || ev.action;
    console.log(c.mag("✦") + " " + c.gray("classify") + "  " + c.bold(label) + (ev.reason ? c.dim("  — " + ev.reason) : ""));
    console.log(c.gray("│"));
    return;
  }
  if (k === "done") {
    console.log(c.green("●") + " " + c.gray("done"));
    return;
  }
}

// ---------------------------------------------------------------------------
// Browser open
// ---------------------------------------------------------------------------

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// ---------------------------------------------------------------------------
// Project tagging
// ---------------------------------------------------------------------------

function tagWithProject(text, projectFlag) {
  const project = projectFlag || process.env.ICOG_PROJECT;
  if (!project) return text;
  return `[Project: ${project}] ${text}`;
}

// ---------------------------------------------------------------------------
// Commands: auth
// ---------------------------------------------------------------------------

async function cmdAuthLogin() {
  if (process.env.ICOG_API_KEY) {
    out(c.green("✓") + " using ICOG_API_KEY from environment", { ok: true, source: "env" });
    return;
  }
  if (!JSON_MODE) console.log(c.dim("Starting device login..."));
  const init = await httpRequest("POST", "/api/auth/mcp/device", { auth: false, retries: false });
  const { device_code, verification_url, expires_in = 300, interval = 3 } = init;

  if (!JSON_MODE) {
    console.log("");
    console.log("  Open this URL in your browser to log in:");
    console.log("");
    console.log("  " + c.cyan(c.bold(verification_url)));
    console.log("");
    console.log(c.dim(`  Waiting for authorization (expires in ${expires_in}s)...`));
    openBrowser(verification_url);
  } else {
    process.stderr.write(JSON.stringify({ verification_url, expires_in }) + "\n");
  }

  const deadline = Date.now() + expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    let result;
    try { result = await httpRequest("GET", `/api/auth/mcp/poll?code=${encodeURIComponent(device_code)}`, { auth: false, retries: false }); }
    catch { continue; }
    if (result.status === "authorized") {
      const creds = loadCreds();
      creds.api_key = result.api_key;
      if (result.email) creds.email = result.email;
      saveCreds(creds);
      out(
        c.green("✓") + ` authorized${result.email ? ` as ${c.bold(result.email)}` : ""}\n  ${c.dim("credentials saved to " + CREDS_PATH)}`,
        { ok: true, email: result.email || null, path: CREDS_PATH }
      );
      return;
    }
    if (result.status === "expired") die("authorization expired. Run again.");
  }
  die("authorization timed out");
}

function cmdAuthStatus() {
  if (process.env.ICOG_API_KEY) {
    out(c.green("✓") + " authenticated via ICOG_API_KEY", { ok: true, source: "env" });
    return;
  }
  const creds = loadCreds();
  if (!creds.api_key) die("not authenticated. Run: cogx auth login");
  out(
    c.green("✓") + " authenticated" + (creds.email ? ` as ${c.bold(creds.email)}` : "") + "\n  " + c.dim(CREDS_PATH),
    { ok: true, source: "file", email: creds.email || null, path: CREDS_PATH }
  );
}

function cmdAuthLogout() {
  try { fs.unlinkSync(CREDS_PATH); out(c.green("✓") + " logged out", { ok: true }); }
  catch { out(c.dim("nothing to log out from"), { ok: true, noop: true }); }
}

async function cmdAuthSet(args) {
  let key = args[0];
  if (!key) key = (await readStdin()).trim();
  if (!key) die("usage: cogx auth set <api_key>  (or pipe via stdin)");
  if (!/^[A-Za-z0-9_-]+$/.test(key) || key.length < 16) die("api key looks malformed");

  // Validate against the API before saving
  API_KEY_OVERRIDE = key;
  let email = null;
  try {
    await httpRequest("GET", "/api/consciousness/reflect", { retries: false });
    // Best-effort: try to fetch profile email
    try { const p = await httpRequest("GET", "/api/profile", { retries: false }); email = p?.email || null; }
    catch {}
  } catch (e) {
    API_KEY_OVERRIDE = "";
    die(`api key rejected: ${e.message}`);
  }

  const creds = loadCreds();
  creds.api_key = key;
  if (email) creds.email = email;
  saveCreds(creds);
  out(
    `${c.green("✓")} api key saved${email ? ` (${c.bold(email)})` : ""}\n  ${c.dim(CREDS_PATH)}`,
    { ok: true, email, path: CREDS_PATH }
  );
}

// ---------------------------------------------------------------------------
// Commands: mcp install
// ---------------------------------------------------------------------------

// Platform-aware config paths for every agent that speaks MCP's standard
// `mcpServers` schema. Targets using non-standard schemas (Zed's
// `context_servers`, Continue's nested config) are intentionally excluded —
// they need format-specific writers.
function appDataDir() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(os.homedir(), ".config");
}

const AGENT_TARGETS = {
  claude: {
    name: "Claude Code",
    path: () => path.join(os.homedir(), ".claude", "mcp.json"),
    detect: () => fs.existsSync(path.join(os.homedir(), ".claude")),
  },
  "claude-desktop": {
    name: "Claude Desktop",
    path: () => path.join(appDataDir(), "Claude", "claude_desktop_config.json"),
    detect: () => fs.existsSync(path.join(appDataDir(), "Claude")),
  },
  cursor: {
    name: "Cursor",
    path: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    detect: () => fs.existsSync(path.join(os.homedir(), ".cursor")),
  },
  windsurf: {
    name: "Windsurf",
    path: () => path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"),
    detect: () => fs.existsSync(path.join(os.homedir(), ".codeium", "windsurf")),
  },
  cline: {
    name: "Cline (VS Code)",
    path: () => path.join(
      appDataDir(), "Code", "User", "globalStorage",
      "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json",
    ),
    detect: () => fs.existsSync(path.join(
      appDataDir(), "Code", "User", "globalStorage", "saoudrizwan.claude-dev",
    )),
  },
  vscode: {
    name: "VS Code",
    path: () => path.join(os.homedir(), ".vscode", "mcp.json"),
    detect: () => fs.existsSync(path.join(os.homedir(), ".vscode")),
  },
};

function buildMcpConfig(apiKey) {
  return {
    mcpServers: {
      icog: {
        type: "http",
        url: `${API_URL}/mcp/`,
        headers: { "X-API-Key": apiKey },
      },
    },
  };
}

function writeMcpConfig(target, apiKey) {
  const cfgPath = target.path();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { /* fresh file */ }
  const merged = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers || {}),
      ...buildMcpConfig(apiKey).mcpServers,
    },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2));
  return cfgPath;
}

function isAgentInstalled(target) {
  try { return target.detect(); } catch { return false; }
}

async function cmdMcpInstall(args, flags) {
  const apiKey = getApiKey();
  const isAll = flags.all || args[0] === "all";

  if (isAll) {
    const results = [];
    const skipped = [];
    for (const [agentKey, target] of Object.entries(AGENT_TARGETS)) {
      if (!isAgentInstalled(target)) { skipped.push({ agent: agentKey, name: target.name }); continue; }
      const p = writeMcpConfig(target, apiKey);
      results.push({ agent: agentKey, name: target.name, path: p });
    }
    if (JSON_MODE) {
      console.log(JSON.stringify({ ok: true, installed: results, skipped }));
      return;
    }
    if (!results.length) {
      console.log(c.dim("no supported agents detected on this system."));
      if (skipped.length) console.log(c.dim("  checked: " + skipped.map((s) => s.name).join(", ")));
      return;
    }
    console.log(c.bold(`✓ installed iCog MCP for ${results.length} agent${results.length === 1 ? "" : "s"}:`));
    for (const r of results) console.log(`  ${c.green("✓")} ${r.name} ${c.dim(r.path)}`);
    if (skipped.length) {
      console.log(c.dim(`\n  not detected (skipped): ${skipped.map((s) => s.name).join(", ")}`));
    }
    console.log(c.dim("\n  Restart the affected agents to activate."));
    return;
  }

  const agent = args[0] || flags.agent || "claude";
  const target = AGENT_TARGETS[agent];
  if (!target) die(`unknown agent: ${agent}. choices: ${Object.keys(AGENT_TARGETS).join(", ")} | all`);

  const cfgPath = writeMcpConfig(target, apiKey);
  out(
    `${c.green("✓")} installed iCog MCP for ${c.bold(target.name)}\n  ${c.dim(cfgPath)}\n\n  ${c.dim("Restart " + target.name + " to activate.")}`,
    { ok: true, agent, path: cfgPath, name: target.name },
  );
}

function cmdMcpList() {
  const installed = [];
  const detected = [];
  for (const [agent, target] of Object.entries(AGENT_TARGETS)) {
    const p = target.path();
    const present = isAgentInstalled(target);
    if (present) detected.push({ agent, name: target.name });
    try {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (cfg && cfg.mcpServers && cfg.mcpServers.icog) {
        installed.push({ agent, name: target.name, path: p });
      }
    } catch { /* not configured */ }
  }
  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, installed, detected })); return; }
  if (!installed.length) {
    console.log(c.dim("iCog MCP not installed in any known agent."));
    if (detected.length) {
      console.log(c.dim("  detected on system: " + detected.map((d) => d.name).join(", ")));
      console.log(c.dim("  install everywhere: cogx mcp install --all"));
    }
    return;
  }
  console.log(c.bold("iCog MCP installed in:"));
  for (const i of installed) console.log(`  ${c.green("✓")} ${i.name} ${c.dim(i.path)}`);
}

async function cmdMcpUninstall(args, flags) {
  const isAll = flags.all || args[0] === "all";
  const removed = [];

  if (isAll) {
    for (const [agent, target] of Object.entries(AGENT_TARGETS)) {
      const cfgPath = target.path();
      let cfg;
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { continue; }
      if (!(cfg.mcpServers && cfg.mcpServers.icog)) continue;
      delete cfg.mcpServers.icog;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      removed.push({ agent, name: target.name });
    }
    if (JSON_MODE) { console.log(JSON.stringify({ ok: true, removed })); return; }
    if (!removed.length) { console.log(c.dim("nothing to remove — iCog not found in any known config.")); return; }
    console.log(c.bold(`✓ removed iCog from ${removed.length} agent${removed.length === 1 ? "" : "s"}:`));
    for (const r of removed) console.log(`  ${c.green("✓")} ${r.name}`);
    return;
  }

  const agent = args[0];
  if (!agent) die("usage: cogx mcp uninstall <agent>  (or 'all' / --all)");
  const target = AGENT_TARGETS[agent];
  if (!target) die(`unknown agent: ${agent}`);
  const cfgPath = target.path();
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
  catch { die(`no config at ${cfgPath}`); }
  if (cfg.mcpServers) delete cfg.mcpServers.icog;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  out(`${c.green("✓")} removed iCog from ${target.name}`, { ok: true, agent });
}

// Refresh the iCog entry in every config that already has one. Useful after
// rotating an API key or switching ICOG_API_URL.
async function cmdMcpUpdate(args, flags) {
  const apiKey = getApiKey();
  const targets = (flags.all || args[0] === "all" || !args[0])
    ? Object.entries(AGENT_TARGETS)
    : [[args[0], AGENT_TARGETS[args[0]]]];

  if (!targets[0] || !targets[0][1]) die(`unknown agent: ${args[0]}`);

  const updated = [];
  const skipped = [];
  for (const [agent, target] of targets) {
    const cfgPath = target.path();
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
    catch { skipped.push({ agent, name: target.name, reason: "no-config" }); continue; }
    if (!(cfg.mcpServers && cfg.mcpServers.icog)) {
      skipped.push({ agent, name: target.name, reason: "no-icog" });
      continue;
    }
    cfg.mcpServers.icog = buildMcpConfig(apiKey).mcpServers.icog;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    updated.push({ agent, name: target.name, path: cfgPath });
  }

  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, updated, skipped })); return; }
  if (!updated.length) {
    console.log(c.dim("nothing to update — iCog not found in any known config."));
    console.log(c.dim("  run `cogx mcp install --all` to install everywhere."));
    return;
  }
  console.log(c.bold(`✓ refreshed iCog MCP in ${updated.length} agent${updated.length === 1 ? "" : "s"}:`));
  for (const u of updated) console.log(`  ${c.green("✓")} ${u.name} ${c.dim(u.path)}`);
  console.log(c.dim("\n  Restart the affected agents to pick up the new credentials."));
}

// ---------------------------------------------------------------------------
// Commands: memory
// ---------------------------------------------------------------------------

async function cmdRecall(args, flags) {
  let query = args.join(" ").trim();
  const stdinData = await readStdin();
  if (stdinData) query = (query + " " + stdinData).trim();
  if (!query) die("usage: cogx recall <query>  (or pipe via stdin)");

  query = tagWithProject(query, flags.project);
  const limit = parseInt(flags.limit || "8", 10);
  const deep = !!flags.deep;
  const payload = { query, limit, deep };
  if (flags.type) payload.memory_type = flags.type;

  if (deep) {
    const events = [];
    let final = null;
    await httpStream("POST", "/api/consciousness/recall", {
      body: payload,
      onEvent: ({ data }) => {
        if (!data || typeof data !== "object") return;
        events.push(data);
        if (!JSON_MODE) renderChainEvent(data);
        if (data.kind === "done") final = data;
      },
    });
    final = final || {};
    const memories = final.memories || [];
    if (JSON_MODE) { console.log(JSON.stringify({ ok: true, query, deep: true, events, memories, summary: final.summary || "" })); return; }
    console.log("");
    if (final.summary) console.log(c.dim("Summary: ") + final.summary + "\n");
    console.log(c.dim(`Searched ${final.total_searched || 0} memories across ${final.turns || 0} turn(s).\n`));
    if (!memories.length) { console.log(c.dim("No relevant memories found.")); return; }
    for (let i = 0; i < memories.length; i++) {
      const m = memories[i];
      const mtype = m.memory_type || "?";
      const sim = m.similarity != null ? ` ${c.dim(`sim=${m.similarity.toFixed(2)}`)}` : "";
      console.log(`${c.cyan(`${i + 1}.`)} ${c.gray(`[${mtype}]`)}${sim}`);
      console.log(`   ${m.text || ""}`);
      console.log(c.dim(`   id: ${m.id}`));
      console.log("");
    }
    return;
  }

  const result = await httpRequest("POST", "/api/consciousness/recall", { body: payload });
  const memories = result.memories || [];

  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, query, count: memories.length, memories })); return; }
  if (!memories.length) { console.log(c.dim("No relevant memories found.")); return; }
  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    const mtype = m.memory_type || "?";
    const age = m.age_days != null ? `${m.age_days}d ago` : "";
    const sim = m.similarity != null ? ` ${c.dim(`sim=${m.similarity.toFixed(2)}`)}` : "";
    console.log(`${c.cyan(`${i + 1}.`)} ${c.gray(`[${mtype}]`)} ${c.gray(age)}${sim}`);
    console.log(`   ${m.text || ""}`);
    console.log(c.dim(`   id: ${m.id}`));
    console.log("");
  }
}

async function cmdRemember(args, flags) {
  let content = args.join(" ").trim();
  const stdinData = await readStdin();
  if (stdinData) content = content ? `${content}\n\n${stdinData}` : stdinData;
  if (!content) die("usage: cogx remember <text> [--type semantic|episodic|procedural|foundational]\n       (or pipe via stdin)");

  content = tagWithProject(content, flags.project);
  const memType = flags.type || "semantic";
  const deep = !!flags.deep;

  if (deep) {
    const events = [];
    let final = null;
    await httpStream("POST", "/api/consciousness/remember", {
      body: { content, memory_type: memType, deep: true },
      onEvent: ({ data }) => {
        if (!data || typeof data !== "object") return;
        events.push(data);
        if (!JSON_MODE) renderChainEvent(data);
        if (data.kind === "done") final = data;
      },
    });
    final = final || {};
    if (JSON_MODE) { console.log(JSON.stringify({ ok: true, deep: true, ...final, events })); return; }
    console.log("");
    const id = final.memory_id || "";
    if (final.action === "skip_duplicate") {
      console.log(c.yellow("⤬") + ` skipped — duplicate of ${id.slice(0, 8)} ${c.dim(final.reason || "")}`);
    } else if (final.action === "refine") {
      console.log(c.green("✓") + ` refinement stored (${id.slice(0, 8)}) related to ${(final.target_id || "?").slice(0, 8)}`);
    } else if (final.action === "error") {
      console.log(c.red("✗") + " failed to store memory");
    } else {
      console.log(c.green("✓") + ` remembered (${id.slice(0, 8)}) [${memType}]`);
    }
    return;
  }

  const result = await httpRequest("POST", "/api/consciousness/remember", { body: { content, memory_type: memType } });
  const id = result.memory_id || result.id || "";
  out(
    `${c.green("✓")} remembered (${id.slice(0, 8)}) [${memType}]`,
    { ok: true, memory_id: id, memory_type: memType }
  );
}

async function cmdForget(args) {
  const id = args[0];
  if (!id) die("usage: cogx forget <memory_id>");
  await httpRequest("POST", "/api/consciousness/forget", { body: { memory_id: id } });
  out(`${c.green("✓")} forgotten ${id.slice(0, 8)}`, { ok: true, memory_id: id });
}

async function cmdUpdate(args) {
  const id = args[0];
  const content = args.slice(1).join(" ").trim() || (await readStdin());
  if (!id || !content) die("usage: cogx update <memory_id> <new content>");
  const result = await httpRequest("POST", "/api/consciousness/update", { body: { memory_id: id, content } });
  const newId = result.new_memory_id || result.memory_id || "";
  out(`${c.green("✓")} updated → ${newId.slice(0, 8)}`, { ok: true, new_memory_id: newId });
}

async function cmdTalk(args, flags) {
  let message = args.join(" ").trim();
  const stdinData = await readStdin();
  if (stdinData) message = message ? `${message}\n\n${stdinData}` : stdinData;
  if (!message) die("usage: cogx talk <message>  (or pipe via stdin)");

  message = tagWithProject(message, flags.project);
  if (!JSON_MODE) process.stdout.write(c.dim("thinking... "));
  const result = await httpRequest("POST", "/api/consciousness/talk", { body: { message } });
  if (!JSON_MODE) process.stdout.write("\r" + " ".repeat(20) + "\r");

  if (JSON_MODE) {
    console.log(JSON.stringify({ ok: true, response: result.response || "", context_used: result.context_used || 0 }));
    return;
  }
  console.log(renderMarkdown(result.response || ""));
  if (result.context_used) console.log(c.dim(`\n[${result.context_used} memories recalled]`));
}

async function cmdReflect() {
  const r = await httpRequest("GET", "/api/consciousness/reflect");
  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, ...r })); return; }
  console.log(`${c.bold("Consciousness:")} ${c.mag(r.consciousness_level || "N/A")}`);
  console.log(`${c.bold("Memories:")}      ${r.memory_count || 0}`);
  if (r.captured_at) console.log(c.dim(`captured ${r.captured_at.slice(0, 19)}`));
  if (r.narrative) { console.log(""); console.log(renderMarkdown(r.narrative)); }
}

async function cmdIntrospect() {
  const [moodR, persR, refR] = await Promise.allSettled([
    httpRequest("GET", "/api/introspect/mood"),
    httpRequest("GET", "/api/introspect/personality"),
    httpRequest("GET", "/api/consciousness/reflect"),
  ]);
  const mood = moodR.status === "fulfilled" ? moodR.value : null;
  const personality = persR.status === "fulfilled" ? persR.value : null;
  const reflect = refR.status === "fulfilled" ? refR.value : null;

  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, mood, personality, reflect })); return; }
  if (reflect) {
    console.log(`${c.bold("Consciousness:")} level ${c.mag(reflect.consciousness_level || "?")} | ${reflect.memory_count || 0} memories`);
    if (reflect.narrative) console.log(c.dim("Narrative: ") + renderMarkdown(reflect.narrative));
  }
  if (mood && mood.effective) {
    const e = mood.effective;
    const active = e.mood_active ? c.green("[active]") : c.dim("[inactive]");
    console.log(`${c.bold("Mood (VAD):")}    valence=${(e.valence || 0).toFixed(2)} arousal=${(e.arousal || 0).toFixed(2)} dominance=${(e.dominance || 0).toFixed(2)} ${active}`);
  }
  if (personality && personality.dimensions) {
    console.log(`${c.bold("Traits:")}`);
    for (const traits of Object.values(personality.dimensions)) {
      for (const [name, state] of Object.entries(traits)) {
        const score = (state.effective || 0).toFixed(2);
        const bar = renderBar(state.effective || 0);
        console.log(`  ${c.dim(name.padEnd(18))} ${bar} ${c.dim(score)}`);
      }
    }
  }
}

function renderBar(v) {
  const width = 20;
  const filled = Math.max(0, Math.min(width, Math.round(((v + 1) / 2) * width))); // -1..1 → 0..width
  return c.cyan("█".repeat(filled)) + c.gray("░".repeat(width - filled));
}

async function cmdLearn(args, flags) {
  const outcome = args[0];
  if (!outcome) die("usage: cogx learn <outcome> [--metadata '{...}']");
  const metadata = flags.metadata ? JSON.parse(flags.metadata) : {};
  await httpRequest("POST", "/api/consciousness/learn", { body: { outcome, metadata } });
  out(`${c.green("✓")} learning recorded: ${outcome}`, { ok: true, outcome });
}

async function cmdDream() {
  const r = await httpRequest("POST", "/api/mind/dreams/trigger");
  out(c.green("✓") + " " + (r.message || "dream consolidation triggered"), { ok: true, ...r });
}

async function cmdDreamStatus() {
  let r;
  try { r = await httpRequest("GET", "/api/mind/dreams/progress"); }
  catch (e) {
    if (e.status === 404) { out(c.dim("no dream job running"), { ok: true, running: false }); return; }
    throw e;
  }
  if (!r) { out(c.dim("no dream job running"), { ok: true, running: false }); return; }
  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, running: true, ...r })); return; }
  const pct = r.total ? Math.round((r.step / r.total) * 100) : 0;
  console.log(`${c.bold("Status:")} ${r.status || "unknown"}`);
  console.log(`${c.bold("Job:")}    ${r.job || ""}`);
  console.log(`${c.bold("Progress:")} ${r.step || 0}/${r.total || 0} (${pct}%)`);
  if (r.error) console.log(c.red("Error: ") + r.error);
}

async function cmdSaveSession(args, flags) {
  const summary = args.join(" ").trim() || (await readStdin());
  if (!summary) die("usage: cogx save-session <summary>  (or pipe via stdin)");
  const project = flags.project || process.env.ICOG_PROJECT || "";
  const decisions = flags.decisions || "";

  const parts = [`Claude Code session summary: ${summary}`];
  if (project) parts.push(`Project: ${project}`);
  if (decisions) parts.push(`Key decisions: ${decisions}`);

  const r = await httpRequest("POST", "/api/consciousness/remember", { body: { content: parts.join("\n"), memory_type: "episodic" } });
  await httpRequest("POST", "/api/consciousness/learn", { body: { outcome: "claude_code_session", metadata: { project, summary_length: summary.length } } });
  const id = r.memory_id || "";
  out(`${c.green("✓")} session saved (${id.slice(0, 8)})`, { ok: true, memory_id: id });
}

async function cmdIdentify(args, flags) {
  const name = args[0];
  if (!name) die("usage: cogx identify <name> [--type coding|research|writing|...] [--description '...']");
  const r = await httpRequest("POST", "/api/agents/register", {
    body: {
      name,
      agent_type: flags.type || "coding",
      description: flags.description || "",
      current_task: flags.task || "",
    },
  });
  const creds = loadCreds();
  if (r.slug) creds.agent_slug = r.slug;
  saveCreds(creds);
  out(
    `${c.green("✓")} ${r.created ? "registered" : "updated"} as '${name}' (slug: ${r.slug || "?"})`,
    { ok: true, name, slug: r.slug, created: !!r.created }
  );
}

async function cmdSearch(args, flags) {
  let query = args.join(" ").trim();
  const stdinData = await readStdin();
  if (stdinData) query = (query + " " + stdinData).trim();
  if (!query) die("usage: cogx search <query>");
  const max = parseInt(flags.limit || "5", 10);
  const r = await httpRequest("POST", "/api/consciousness/search", { body: { query, max_results: max } });
  const results = r.results || [];
  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, query, results })); return; }
  if (!results.length) { console.log(c.dim(`No results for: ${query}`)); return; }
  for (const item of results) {
    console.log(c.bold(item.title || ""));
    console.log(c.cyan(item.url || ""));
    console.log(c.dim((item.snippet || "").slice(0, 200)));
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Commands: doctor + self-update
// ---------------------------------------------------------------------------

// Fetch the latest published version of @cognitivx/cli from the npm registry.
// Returns null on any failure (offline, registry down, parse error) so doctor
// can keep reporting other checks instead of bailing.
async function fetchLatestPublishedVersion() {
  try {
    const res = await fetch("https://registry.npmjs.org/@cognitivx/cli/latest", {
      headers: { Accept: "application/json", "User-Agent": `cogx/${VERSION}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.version || null;
  } catch { return null; }
}

// Numeric semver compare for "x.y.z" — returns -1 / 0 / 1.
function compareSemver(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

async function cmdDoctor() {
  const checks = [];
  const add = (name, ok, detail, hint) => checks.push({ name, ok, detail, hint });

  // Node version
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  add("Node.js", nodeMajor >= 18, `v${process.versions.node}`, nodeMajor >= 18 ? null : "upgrade to Node 18 or newer");

  // Fetch availability (already enforced at start, but report it)
  add("fetch()", typeof fetch === "function", typeof fetch === "function" ? "built-in available" : "missing");

  // Config dir
  const credsExist = fs.existsSync(CREDS_PATH);
  const envKey = !!process.env.ICOG_API_KEY;
  add("Credentials", credsExist || envKey,
    envKey ? "via ICOG_API_KEY env" : credsExist ? CREDS_PATH : "not found",
    (credsExist || envKey) ? null : "run: cogx auth login");

  // API URL reachable (no auth required for a HEAD-like probe — try /api/health
  // and accept any 2xx/4xx as "reachable"; 5xx or network error fails the check)
  let apiOk = false;
  let apiDetail = API_URL;
  try {
    const res = await fetch(`${API_URL}/api/health`, { method: "GET" });
    apiOk = res.status < 500;
    apiDetail = `${API_URL} → ${res.status}`;
  } catch (e) {
    apiDetail = `${API_URL} → ${e.message}`;
  }
  add("API reachable", apiOk, apiDetail, apiOk ? null : "check network / ICOG_API_URL");

  // Auth validity (only if credentials present)
  let authOk = null;
  let authDetail = "skipped — no credentials";
  if (credsExist || envKey) {
    try {
      await httpRequest("GET", "/api/consciousness/reflect", { retries: false });
      authOk = true;
      authDetail = "key accepted";
    } catch (e) {
      authOk = false;
      authDetail = e.message;
    }
    add("Auth", authOk, authDetail, authOk ? null : "run: cogx auth login");
  } else {
    add("Auth", null, authDetail);
  }

  // MCP install summary
  const mcpInstalled = [];
  for (const [agent, target] of Object.entries(AGENT_TARGETS)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(target.path(), "utf8"));
      if (cfg && cfg.mcpServers && cfg.mcpServers.icog) mcpInstalled.push(target.name);
    } catch { /* not configured */ }
  }
  add("MCP installs", mcpInstalled.length > 0,
    mcpInstalled.length ? mcpInstalled.join(", ") : "none configured",
    mcpInstalled.length ? null : "run: cogx mcp install --all");

  // Latest version check
  const latest = await fetchLatestPublishedVersion();
  if (latest) {
    const cmp = compareSemver(VERSION, latest);
    add("Version", cmp >= 0, `v${VERSION}${cmp < 0 ? ` → v${latest} available` : " (latest)"}`,
      cmp < 0 ? "run: cogx self-update" : null);
  } else {
    add("Version", null, `v${VERSION} (offline, can't check latest)`);
  }

  if (JSON_MODE) { console.log(JSON.stringify({ ok: checks.every((c) => c.ok !== false), checks })); return; }

  console.log(c.bold("cogx doctor"));
  for (const ch of checks) {
    const icon = ch.ok === true ? c.green("✓") : ch.ok === false ? c.red("✗") : c.dim("·");
    const name = ch.name.padEnd(16);
    const detail = ch.detail ? " " + c.dim(ch.detail) : "";
    console.log(`  ${icon} ${name}${detail}`);
    if (ch.hint && ch.ok === false) console.log(`    ${c.dim("→ " + ch.hint)}`);
  }
  const failed = checks.filter((c) => c.ok === false).length;
  console.log("");
  console.log(failed === 0 ? c.green("all clear.") : c.yellow(`${failed} issue${failed === 1 ? "" : "s"} to address.`));
}

async function cmdSelfUpdate(_args, flags) {
  const latest = await fetchLatestPublishedVersion();
  if (!latest) {
    if (JSON_MODE) { console.log(JSON.stringify({ ok: false, error: "couldn't reach npm registry" })); return; }
    die("couldn't reach npm registry — check network");
  }
  const cmp = compareSemver(VERSION, latest);
  if (cmp >= 0 && !flags.force) {
    if (JSON_MODE) { console.log(JSON.stringify({ ok: true, current: VERSION, latest, action: "noop" })); return; }
    console.log(`${c.green("✓")} already on the latest version ${c.bold("v" + VERSION)}.`);
    return;
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ ok: true, current: VERSION, latest, action: "upgrade" }));
  } else {
    console.log(`${c.cyan("↑")} upgrading from ${c.bold("v" + VERSION)} → ${c.bold("v" + latest)} ...`);
  }

  // Run npm install in the user's shell. We don't try sudo or alternate package
  // managers — if their environment needs sudo or uses pnpm/yarn, we tell them.
  const cmd = "npm install -g @cognitivx/cli@latest";
  await new Promise((resolve) => {
    exec(cmd, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        if (JSON_MODE) {
          console.log(JSON.stringify({ ok: false, error: err.message, hint: "may need sudo or different package manager" }));
        } else {
          console.log(c.red("✗ upgrade failed:"));
          console.log(c.dim((stderr || err.message).trim()));
          console.log("");
          console.log(c.dim("try: sudo " + cmd));
          console.log(c.dim("or:  pnpm add -g @cognitivx/cli@latest"));
          console.log(c.dim("or:  yarn global add @cognitivx/cli@latest"));
        }
        resolve();
        return;
      }
      if (JSON_MODE) {
        console.log(JSON.stringify({ ok: true, current: VERSION, latest, action: "upgraded" }));
      } else {
        console.log(`${c.green("✓")} upgraded to ${c.bold("v" + latest)}.`);
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Interactive chat (REPL) with persistent history
// ---------------------------------------------------------------------------

function loadHistory() {
  try { return fs.readFileSync(HISTORY_PATH, "utf8").split("\n").filter(Boolean).reverse().slice(0, 200); }
  catch { return []; }
}

function appendHistory(line) {
  if (!line || line.startsWith("/")) return;
  try {
    fs.mkdirSync(ICOG_DIR, { recursive: true });
    fs.appendFileSync(HISTORY_PATH, line + "\n");
  } catch {}
}

async function cmdChat(_args, flags) {
  if (JSON_MODE) die("--json is not supported in interactive chat mode");
  console.log(c.dim("iCog chat — type a message, ctrl+c to exit. /help for commands."));
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c.cyan("you ❯ "),
    terminal: true,
    history: loadHistory(),
    historySize: 200,
    removeHistoryDuplicates: true,
  });
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    appendHistory(input);

    if (input === "/help") {
      console.log(c.dim("  /recall <q>       semantic recall"));
      console.log(c.dim("  /remember <text>  store memory"));
      console.log(c.dim("  /reflect          consciousness state"));
      console.log(c.dim("  /quit             exit"));
      return rl.prompt();
    }
    if (input === "/quit" || input === "/exit") { rl.close(); return; }

    try {
      if (input.startsWith("/recall ")) {
        await cmdRecall([input.slice(8)], flags);
      } else if (input.startsWith("/remember ")) {
        await cmdRemember([input.slice(10)], flags);
      } else if (input === "/reflect") {
        await cmdReflect();
      } else {
        const message = tagWithProject(input, flags.project);
        process.stdout.write(c.dim("thinking... "));
        const result = await httpRequest("POST", "/api/consciousness/talk", { body: { message } });
        process.stdout.write("\r" + " ".repeat(20) + "\r");
        console.log(c.mag("icog ❮ ") + renderMarkdown(result.response || ""));
        if (result.context_used) console.log(c.dim(`        [${result.context_used} memories recalled]`));
      }
    } catch (e) {
      console.log(c.red("error: ") + e.message);
    }
    console.log("");
    rl.prompt();
  });

  rl.on("close", () => { console.log(c.dim("\ngoodbye")); process.exit(0); });
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP_BY_CMD = {
  "auth login": `cogx auth login

Sign in to iCog via browser device flow. Stores credentials in ~/.icog/credentials.json.

If ICOG_API_KEY is set in the environment, that is used and no login is needed.`,

  "auth status": `cogx auth status

Show current authentication state.`,

  "auth logout": `cogx auth logout

Remove stored credentials. Does not affect the ICOG_API_KEY env var.`,

  "auth set": `cogx auth set <api_key>

Save an API key directly (skips the device login flow). Validates the key
against the API before saving. Useful for headless setups, CI, or when you
already have a key from the dashboard.

Accepts piped stdin too:
  echo "icog_..." | cogx auth set

Precedence (highest first):
  1. --api-key flag (one-off override)
  2. ICOG_API_KEY env var
  3. Saved credentials at ~/.icog/credentials.json`,

  "mcp install": `cogx mcp install [agent | all] [--all]

Install the iCog MCP into an agent's config file. Default agent: claude.
Pass 'all' or --all to install into every detected agent on this system
(only those whose config directory already exists — won't create new app
data dirs for tools that aren't installed).

Agents:  claude          (Claude Code)        ~/.claude/mcp.json
         claude-desktop  (Claude Desktop)     <app-data>/Claude/claude_desktop_config.json
         cursor          (Cursor)             ~/.cursor/mcp.json
         windsurf        (Windsurf)           ~/.codeium/windsurf/mcp_config.json
         cline           (Cline / VS Code)    <app-data>/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
         vscode          (VS Code native)     ~/.vscode/mcp.json

Uses the remote HTTP MCP at ${API_URL}/mcp/. Restart the agents after install.`,

  "mcp list": `cogx mcp list

List agents that have iCog MCP installed, plus which supported agents are
detected on the system (so you can see what 'mcp install --all' would touch).`,

  "mcp uninstall": `cogx mcp uninstall <agent | all> [--all]

Remove iCog from an agent's MCP config (leaves other servers intact).
Pass 'all' or --all to remove from every config that currently has it.`,

  "mcp update": `cogx mcp update [agent | all] [--all]

Refresh the iCog entry in every config that already has one — pulls a fresh
API key (env > stored credentials) and rewrites the URL and headers. Useful
after rotating a key or switching ICOG_API_URL. Skips configs that don't
already have iCog installed (won't add it; use 'mcp install' for that).
Defaults to all when no agent is specified.`,

  "recall": `cogx recall <query> [--type TYPE] [--limit N] [--project NAME] [--deep] [--json]

Semantic search across your memories. Accepts piped stdin.

Types:   semantic | episodic | procedural | foundational
Project: prepends "[Project: NAME] " to the query
--deep:  adaptive multi-step recall — plans sub-queries, reflects, and
         synthesizes. Streams a live chain to the terminal. Slower (3-8s)
         and uses more LLM calls; best for cross-memory questions.`,

  "remember": `cogx remember <text> [--type TYPE] [--project NAME] [--deep] [--json]

Store a memory. Accepts piped stdin (combined with text args).

Types:   semantic (default) | episodic | procedural | foundational
--deep:  curated remember — recalls related memories first, classifies new
         content as new / duplicate / refinement, and skips dupes. Streams a
         live chain to the terminal.

Examples:
  cogx remember "Auth refactor done"
  cat NOTES.md | cogx remember --type episodic
  cogx remember --project myapp "Switched to PostgreSQL 16"
  cogx remember --deep "We chose adaptive memory recall for iCog"`,

  "forget": `cogx forget <memory_id>

Soft-delete a memory by ID (from a recall result).`,

  "update": `cogx update <memory_id> <new content>

Replace an existing memory with new content. Re-embeds.`,

  "talk": `cogx talk <message> [--project NAME] [--json]

Talk to iCog with full memory context. Accepts piped stdin.`,

  "chat": `cogx chat [--project NAME]

Interactive REPL. Persistent history at ~/.icog/history.

In-chat commands:  /recall <q>  /remember <text>  /reflect  /quit`,

  "reflect": `cogx reflect [--json]

Show consciousness level, memory count, and narrative.`,

  "introspect": `cogx introspect [--json]

Full cognitive mirror: consciousness, mood (VAD), personality traits.`,

  "learn": `cogx learn <outcome> [--metadata '{...}']

Record a learning signal (e.g. "bug_fixed", "feature_shipped").`,

  "dream": `cogx dream

Trigger dream consolidation (memory compression + relationship synthesis).`,

  "dream-status": `cogx dream-status [--json]

Check progress of a running dream consolidation job.`,

  "save-session": `cogx save-session <summary> [--project NAME] [--decisions '...']

Store an episodic memory summarizing the current work session.`,

  "identify": `cogx identify <name> [--type TYPE] [--description '...'] [--task '...']

Register this agent with iCog so its talk() exchanges are attributed.

Types: coding | research | writing | analysis | assistant | orchestrator | general`,

  "doctor": `cogx doctor [--json]

Run a self-diagnostic: Node version, fetch availability, credentials,
API reachability, auth validity, MCP install status, and whether a newer
version of cogx is published. Prints a summary with fix hints for any
failing check.`,

  "self-update": `cogx self-update [--force] [--json]

Check the npm registry for a newer @cognitivx/cli and upgrade in place via
\`npm install -g @cognitivx/cli@latest\`. Skips if already on the latest
unless --force is passed. If the upgrade fails (permissions, alternate
package manager), prints fallback commands for sudo/pnpm/yarn.`,

  "search": `cogx search <query> [--limit N] [--json]

Web search via iCog (Tavily). Accepts piped stdin.`,
};

function help(cmdKey) {
  if (cmdKey && HELP_BY_CMD[cmdKey]) {
    console.log(HELP_BY_CMD[cmdKey]);
    return;
  }
  console.log(`${c.bold("cogx")} ${c.dim("v" + VERSION)} — CogX CLI

${c.bold("Usage:")}  cogx <command> [args] [flags]

${c.bold("Memory:")}
  recall <query>             semantic search
  remember <text>            store a memory
  forget <id>                soft-delete a memory
  update <id> <text>         replace a memory
  talk <message>             talk to iCog with full context
  chat                       interactive REPL
  reflect                    consciousness state
  introspect                 full cognitive mirror (mood, traits)

${c.bold("Cognition:")}
  learn <outcome>            record a learning signal
  dream                      trigger dream consolidation
  dream-status               check dream job progress
  save-session <summary>     store an episodic session memory

${c.bold("Setup:")}
  auth login                 sign in via browser device flow
  auth set <key>             save an API key directly (skip device flow)
  auth status | logout       check auth / clear credentials
  mcp install [agent|all]    install iCog MCP (claude|claude-desktop|cursor|windsurf|cline|vscode|all)
  mcp list                   list installed MCP integrations + detected agents
  mcp update [agent|all]     refresh existing iCog MCP entries (key rotation, URL change)
  mcp uninstall <agent|all>  remove iCog from one or all agents

${c.bold("Other:")}
  identify <name>            register agent identity
  search <query>             web search via iCog
  doctor                     diagnose install: node, auth, API, MCP, version
  self-update                upgrade cogx to the latest published version

${c.bold("Global flags:")}
  --json, -j                 emit JSON output (machine-readable)
  --api-key KEY              one-off API key (overrides env + saved creds)
  --project, -p NAME         tag query/content with [Project: NAME]
  --type, -t TYPE            memory type (semantic|episodic|procedural|foundational)
  --limit, -l N              limit results (recall, search)
  --help, -h                 show help (use 'cogx <cmd> --help' for command help)
  --version, -v              print version

${c.bold("Env:")}
  ICOG_API_KEY               override stored credentials
  ICOG_API_URL               override API endpoint (default: ${API_URL})
  ICOG_PROJECT               default project tag
  ICOG_TIMEOUT_MS            request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  NO_COLOR=1                 disable color output

Run 'cogx <command> --help' for detailed help on a specific command.
`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const COMMANDS = {
  "auth": {
    sub: {
      "login":  cmdAuthLogin,
      "status": cmdAuthStatus,
      "logout": cmdAuthLogout,
      "set":    cmdAuthSet,
    },
    helpKey: (sub) => `auth ${sub}`,
  },
  "mcp": {
    sub: {
      "install":   cmdMcpInstall,
      "list":      cmdMcpList,
      "uninstall": cmdMcpUninstall,
      "update":    cmdMcpUpdate,
    },
    helpKey: (sub) => `mcp ${sub}`,
  },
  "recall":       { fn: cmdRecall },
  "remember":     { fn: cmdRemember },
  "forget":       { fn: cmdForget },
  "update":       { fn: cmdUpdate },
  "talk":         { fn: cmdTalk },
  "chat":         { fn: cmdChat },
  "reflect":      { fn: cmdReflect },
  "introspect":   { fn: cmdIntrospect },
  "learn":        { fn: cmdLearn },
  "dream":        { fn: cmdDream },
  "dream-status": { fn: cmdDreamStatus },
  "save-session": { fn: cmdSaveSession },
  "identify":     { fn: cmdIdentify },
  "search":       { fn: cmdSearch },
  "doctor":       { fn: cmdDoctor },
  "self-update":  { fn: cmdSelfUpdate },
};

(async () => {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { help(); return; }

  const first = argv[0];
  if (first === "--version" || first === "-v") { console.log(VERSION); return; }
  if (first === "--help" || first === "-h" || first === "help") { help(argv.slice(1).join(" ").trim()); return; }

  const cmd = COMMANDS[first];
  if (!cmd) { console.error(c.red("unknown command:") + " " + first); help(); process.exit(1); }

  let handler, helpKey, rest;
  if (cmd.sub) {
    const sub = argv[1];
    if (!sub) die(`usage: cogx ${first} <${Object.keys(cmd.sub).join("|")}>`);
    handler = cmd.sub[sub];
    if (!handler) die(`unknown subcommand: ${first} ${sub}`);
    helpKey = cmd.helpKey(sub);
    rest = argv.slice(2);
  } else {
    handler = cmd.fn;
    helpKey = first;
    rest = argv.slice(1);
  }

  const { flags, positional } = parseArgs(rest);
  if (flags.help) { help(helpKey); return; }
  JSON_MODE = !!flags.json;
  if (flags["api-key"] && typeof flags["api-key"] === "string") API_KEY_OVERRIDE = flags["api-key"];

  try {
    await handler(positional, flags);
  } catch (e) {
    die(e.message || String(e));
  }
})();
