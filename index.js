#!/usr/bin/env node
// cogx — iCog CLI. Pure Node.js, zero deps. Requires Node 18+.
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

const VERSION = "1.0.0";
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
  cyan:  (s) => TTY ? `\x1b[36m${s}\x1b[0m` : s,
  green: (s) => TTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:   (s) => TTY ? `\x1b[31m${s}\x1b[0m` : s,
  mag:   (s) => TTY ? `\x1b[35m${s}\x1b[0m` : s,
  gray:  (s) => TTY ? `\x1b[90m${s}\x1b[0m` : s,
  yellow:(s) => TTY ? `\x1b[33m${s}\x1b[0m` : s,
};

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
      if (next !== undefined && !next.startsWith("-")) { flags[key] = next; i++; }
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

const AGENT_TARGETS = {
  claude:   { path: () => path.join(os.homedir(), ".claude", "mcp.json"), name: "Claude Code" },
  cursor:   { path: () => path.join(os.homedir(), ".cursor", "mcp.json"), name: "Cursor" },
  windsurf: { path: () => path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"), name: "Windsurf" },
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

async function cmdMcpInstall(args, flags) {
  const agent = args[0] || flags.agent || "claude";
  const target = AGENT_TARGETS[agent];
  if (!target) die(`unknown agent: ${agent}. choices: ${Object.keys(AGENT_TARGETS).join(", ")}`);

  const apiKey = getApiKey();
  const cfgPath = target.path();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
  const merged = { ...existing, mcpServers: { ...(existing.mcpServers || {}), ...buildMcpConfig(apiKey).mcpServers } };
  fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2));

  out(
    `${c.green("✓")} installed iCog MCP for ${c.bold(target.name)}\n  ${c.dim(cfgPath)}\n\n  ${c.dim("Restart " + target.name + " to activate.")}`,
    { ok: true, agent, path: cfgPath, name: target.name }
  );
}

function cmdMcpList() {
  const installed = [];
  for (const [agent, target] of Object.entries(AGENT_TARGETS)) {
    const p = target.path();
    try {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      const has = cfg && cfg.mcpServers && cfg.mcpServers.icog;
      if (has) installed.push({ agent, name: target.name, path: p });
    } catch {}
  }
  if (!installed.length) {
    out(c.dim("iCog MCP not installed in any known agent."), { ok: true, installed: [] });
    return;
  }
  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, installed })); return; }
  console.log(c.bold("iCog MCP installed in:"));
  for (const i of installed) console.log(`  ${c.green("✓")} ${i.name} ${c.dim(i.path)}`);
}

async function cmdMcpUninstall(args) {
  const agent = args[0];
  if (!agent) die("usage: cogx mcp uninstall <agent>");
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
  const payload = { query, limit };
  if (flags.type) payload.memory_type = flags.type;

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
  console.log(result.response || "");
  if (result.context_used) console.log(c.dim(`\n[${result.context_used} memories recalled]`));
}

async function cmdReflect() {
  const r = await httpRequest("GET", "/api/consciousness/reflect");
  if (JSON_MODE) { console.log(JSON.stringify({ ok: true, ...r })); return; }
  console.log(`${c.bold("Consciousness:")} ${c.mag(r.consciousness_level || "N/A")}`);
  console.log(`${c.bold("Memories:")}      ${r.memory_count || 0}`);
  if (r.captured_at) console.log(c.dim(`captured ${r.captured_at.slice(0, 19)}`));
  if (r.narrative) { console.log(""); console.log(r.narrative); }
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
    if (reflect.narrative) console.log(c.dim("Narrative: ") + reflect.narrative);
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
        console.log(c.mag("icog ❮ ") + (result.response || ""));
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

  "mcp install": `cogx mcp install [agent]

Install the iCog MCP into an agent's config file. Default agent: claude.

Agents:  claude   (Claude Code)        ~/.claude/mcp.json
         cursor   (Cursor)             ~/.cursor/mcp.json
         windsurf (Windsurf)           ~/.codeium/windsurf/mcp_config.json

Uses the remote HTTP MCP at ${API_URL}/mcp/. Restart the agent after install.`,

  "mcp list": `cogx mcp list

List agents that have iCog MCP installed.`,

  "mcp uninstall": `cogx mcp uninstall <agent>

Remove iCog from an agent's MCP config (leaves other servers intact).`,

  "recall": `cogx recall <query> [--type TYPE] [--limit N] [--project NAME] [--json]

Semantic search across your memories. Accepts piped stdin.

Types:   semantic | episodic | procedural | foundational
Project: prepends "[Project: NAME] " to the query`,

  "remember": `cogx remember <text> [--type TYPE] [--project NAME] [--json]

Store a memory. Accepts piped stdin (combined with text args).

Types:   semantic (default) | episodic | procedural | foundational

Examples:
  cogx remember "Auth refactor done"
  cat NOTES.md | cogx remember --type episodic
  cogx remember --project myapp "Switched to PostgreSQL 16"`,

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

  "search": `cogx search <query> [--limit N] [--json]

Web search via iCog (Tavily). Accepts piped stdin.`,
};

function help(cmdKey) {
  if (cmdKey && HELP_BY_CMD[cmdKey]) {
    console.log(HELP_BY_CMD[cmdKey]);
    return;
  }
  console.log(`${c.bold("cogx")} ${c.dim("v" + VERSION)} — iCog CLI

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
  mcp install [agent]        install iCog MCP (claude|cursor|windsurf)
  mcp list                   list installed MCP integrations
  mcp uninstall <agent>      remove from an agent

${c.bold("Other:")}
  identify <name>            register agent identity
  search <query>             web search via iCog

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
