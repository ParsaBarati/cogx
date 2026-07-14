// cogx CLI tests — pure Node, no test framework needed.
// Run: node test.js
"use strict";

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const CLI = path.join(__dirname, "index.js");
const fixtureHome = fs.mkdtempSync(require("os").tmpdir() + "/cogx-fixture-");
const fixtureLog = path.join(fixtureHome, "requests.jsonl");
fs.writeFileSync(fixtureLog, "");
const fixturePort = 40000 + (process.pid % 20000);
const fixtureServer = spawn(process.execPath, [path.join(__dirname, "test-fixture-server.js")], {
  env: { ...process.env, COGX_TEST_PORT: String(fixturePort), COGX_TEST_LOG: fixtureLog },
  stdio: "ignore",
});
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
const env = {
  ...process.env,
  NO_COLOR: "1",
  ICOG_API_KEY: "test_dummy_key",
  ICOG_API_URL: `http://127.0.0.1:${fixturePort}`,
  HOME: fixtureHome,
  USERPROFILE: fixtureHome,
};

let pass = 0;
let fail = 0;
const failures = [];

function run(args, opts = {}) {
  return spawnSync("node", [CLI, ...args], {
    env: opts.env || env,
    encoding: "utf8",
    input: opts.stdin,
    timeout: 5000,
  });
}

function assert(name, cond, detail = "") {
  if (cond) { pass++; process.stdout.write("."); }
  else {
    fail++;
    failures.push({ name, detail });
    process.stdout.write("F");
  }
}

function test(name, fn) {
  try { fn(); }
  catch (e) {
    fail++;
    failures.push({ name, detail: `threw: ${e.message}` });
    process.stdout.write("E");
  }
}

function requests() {
  return fs.readFileSync(fixtureLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("--version prints semver", () => {
  const r = run(["--version"]);
  assert("version status", r.status === 0, `status=${r.status}`);
  assert("version format", /^\d+\.\d+\.\d+/.test(r.stdout.trim()), `got=${r.stdout}`);
});

test("--help shows top-level usage", () => {
  const r = run(["--help"]);
  assert("help status", r.status === 0);
  assert("help mentions cogx", r.stdout.includes("cogx"));
  assert("help lists recall", r.stdout.includes("recall"));
  assert("help lists remember", r.stdout.includes("remember"));
  assert("help lists talk", r.stdout.includes("talk"));
  assert("help lists mcp install", r.stdout.includes("mcp install"));
  assert("help lists introspect", r.stdout.includes("introspect"));
  assert("help lists --json flag", r.stdout.includes("--json"));
});

test("no args shows help (exit 0)", () => {
  const r = run([]);
  assert("no-args status", r.status === 0);
  assert("no-args shows usage", r.stdout.includes("Usage"));
});

test("unknown command exits 1", () => {
  const r = run(["nonexistent-cmd"]);
  assert("unknown status", r.status === 1, `status=${r.status}`);
  assert("unknown stderr mentions unknown", /unknown command/i.test(r.stderr));
});

test("per-command help: recall --help", () => {
  const r = run(["recall", "--help"]);
  assert("recall help status", r.status === 0);
  assert("recall help has usage", r.stdout.includes("cogx recall"));
  assert("recall help mentions stdin", /stdin/i.test(r.stdout));
});

test("per-command help: remember --help", () => {
  const r = run(["remember", "--help"]);
  assert("remember help status", r.status === 0);
  assert("remember help shows types", /semantic.*episodic/.test(r.stdout));
});

test("per-command help: mcp install --help", () => {
  const r = run(["mcp", "install", "--help"]);
  assert("mcp help status", r.status === 0);
  assert("mcp help lists agents", /claude.*cursor.*windsurf/s.test(r.stdout));
});

test("missing required arg → error exit", () => {
  const r = run(["forget"]);
  assert("forget no-args status", r.status === 1);
  assert("forget no-args stderr", /usage/i.test(r.stderr));
});

test("JSON mode: error output is JSON", () => {
  const r = run(["forget", "--json"]);
  assert("json error status", r.status === 1);
  let parsed;
  try { parsed = JSON.parse(r.stdout.trim()); }
  catch { parsed = null; }
  assert("json error parses", parsed !== null, `stdout=${r.stdout}`);
  assert("json error has ok=false", parsed && parsed.ok === false);
  assert("json error has error string", parsed && typeof parsed.error === "string");
});

test("JSON mode: mcp list returns valid JSON", () => {
  const r = run(["mcp", "list", "--json"]);
  assert("mcp list status", r.status === 0);
  let parsed;
  try { parsed = JSON.parse(r.stdout.trim()); }
  catch { parsed = null; }
  assert("mcp list parses as JSON", parsed !== null);
  assert("mcp list has ok=true", parsed && parsed.ok === true);
  assert("mcp list has installed array", parsed && Array.isArray(parsed.installed));
});

test("argument parsing: --type, --limit recognized", () => {
  // remember with no content but --type set, no stdin → should still error usage
  // but the error should reach us cleanly (no parse crash)
  const r = run(["remember", "--type", "episodic", "--json"], { stdin: "" });
  assert("flag parse no-crash", r.status === 1);
  let parsed;
  try { parsed = JSON.parse(r.stdout.trim()); } catch { parsed = null; }
  assert("flag parse json output", parsed && parsed.ok === false);
});

test("auth status with no creds and no env → exit 1", () => {
  const cleanEnv = { ...env };
  delete cleanEnv.ICOG_API_KEY;
  // Use a temp HOME so we don't read real credentials
  const tmpHome = fs.mkdtempSync(require("os").tmpdir() + "/cogx-test-");
  cleanEnv.HOME = tmpHome;
  cleanEnv.USERPROFILE = tmpHome;
  const r = run(["auth", "status"], { env: cleanEnv });
  assert("no-creds status", r.status === 1);
  assert("no-creds error", /not authenticated/i.test(r.stderr));
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("auth status with ICOG_API_KEY env → ok", () => {
  const r = run(["auth", "status", "--json"]);
  assert("env-key status", r.status === 0);
  const parsed = JSON.parse(r.stdout.trim());
  assert("env-key json ok", parsed.ok === true);
  assert("env-key source=env", parsed.source === "env");
});

test("mcp install with unknown agent → error", () => {
  const r = run(["mcp", "install", "fake-agent"]);
  assert("bad agent status", r.status === 1);
  assert("bad agent stderr", /unknown agent/i.test(r.stderr));
});

test("argv: short flag -j sets json mode", () => {
  const r = run(["forget", "-j"]);
  assert("short -j status", r.status === 1);
  let parsed;
  try { parsed = JSON.parse(r.stdout.trim()); } catch { parsed = null; }
  assert("short -j produces JSON", parsed && parsed.ok === false);
});

test("argv: short flag -h shows help", () => {
  const r = run(["-h"]);
  assert("short -h status", r.status === 0);
  assert("short -h has usage", r.stdout.includes("Usage"));
});

test("argv: short flag -v prints version", () => {
  const r = run(["-v"]);
  assert("short -v status", r.status === 0);
  assert("short -v is semver", /^\d+\.\d+\.\d+/.test(r.stdout.trim()));
});

test("multiple agents require explicit session identity", () => {
  assert("identify aporta", run(["identify", "Aporta", "--json"]).status === 0);
  assert("identify abarcode", run(["identify", "Abarcode", "--json"]).status === 0);
  const ambiguous = run(["remember", "unsafe", "--json"]);
  assert("ambiguous identity rejected", ambiguous.status === 1, ambiguous.stdout);
  const parsed = JSON.parse(ambiguous.stdout.trim());
  assert("ambiguous error code", parsed.code === "agent_identity_ambiguous");
});

test("--as-user overrides a session identity without leaking attribution", () => {
  const before = requests().length;
  const r = run(["remember", "human note", "--as-user", "--json"], {
    env: { ...env, COGX_AGENT_SLUG: "Automa" },
  });
  assert("as-user remember status", r.status === 0, r.stderr || r.stdout);
  const req = requests().slice(before)[0];
  assert("as-user omits agent slug", req.body.agent_slug === undefined, JSON.stringify(req));
});

test("remember sends agent attribution and shares explicitly", () => {
  const before = requests().length;
  const r = run(["remember", "shared decision", "--agent", "Abarcode", "--share-with", "Aporta", "--json"]);
  assert("attributed remember status", r.status === 0, r.stderr || r.stdout);
  const parsed = JSON.parse(r.stdout.trim());
  assert("remember agent slug", parsed.agent_slug === "abarcode");
  assert("remember shared target", parsed.shared_with[0] === "aporta");
  const delta = requests().slice(before);
  assert("remember payload attributed", delta[0].body.agent_slug === "abarcode", JSON.stringify(delta));
  assert("share actor attributed", delta[1].body.actor_agent_slug === "abarcode", JSON.stringify(delta));
  assert("share target canonical", delta[1].body.target_agent_slug === "aporta", JSON.stringify(delta));
});

test("talk carries agent task and scope", () => {
  const before = requests().length;
  const r = run(["talk", "check architecture", "--agent", "Aporta", "--task", "coordinate Aira", "--scope", "strict", "--json"]);
  assert("talk status", r.status === 0, r.stderr || r.stdout);
  const req = requests().slice(before)[0];
  assert("talk agent", req.body.agent_slug === "aporta");
  assert("talk task", req.body.current_task === "coordinate Aira");
  assert("talk scope", req.body.scope_mode === "strict");
});

test("orchestrate dispatches one shared thread with per-agent tasks", () => {
  const before = requests().length;
  const r = run([
    "orchestrate", "Ship Aira integration",
    "--agent", "Aporta",
    "--agents", "Abarcode,Automa",
    "--tasks", '{"abarcode":"map ERP","automa":"map automation"}',
    "--json",
  ]);
  assert("orchestrate status", r.status === 0, r.stderr || r.stdout);
  const parsed = JSON.parse(r.stdout.trim());
  assert("orchestrate two dispatches", parsed.dispatched.length === 2);
  const sent = requests().slice(before).filter((item) => item.path.endsWith("/message"));
  assert("same thread", sent[0].body.thread_id === undefined && sent[1].body.thread_id === parsed.thread_id, JSON.stringify(sent));
  assert("barcode task", sent[0].body.content === "map ERP");
  assert("automa task", sent[1].body.content === "map automation");
});

test("agent wait/watch help documents delivery awareness", () => {
  const waitHelp = run(["agent", "wait", "--help"]);
  const watchHelp = run(["agent", "watch", "--help"]);
  assert("wait help status", waitHelp.status === 0, waitHelp.stderr);
  assert("wait help timeout", waitHelp.stdout.includes("--timeout"));
  assert("watch help status", watchHelp.status === 0, watchHelp.stderr);
  assert("watch help NDJSON", watchHelp.stdout.includes("NDJSON"));
});

test("agent activate keeps stdout eval-safe and reports unread on stderr", () => {
  const sent = run([
    "agent", "send", "Aporta", "Review the PMP notification release",
    "--agent", "Abarcode", "--context", "CLI delivery-awareness test", "--json",
  ]);
  assert("notification seed sent", sent.status === 0, sent.stderr || sent.stdout);

  const activated = run(["agent", "activate", "Aporta"]);
  assert("activate status", activated.status === 0, activated.stderr);
  assert("activate stdout is export only", activated.stdout.trim() === "export COGX_AGENT_SLUG=aporta", activated.stdout);
  assert("activate stderr has unread notice", /aporta has 1 unread message/.test(activated.stderr), activated.stderr);

  const json = run(["agent", "activate", "Aporta", "--json"]);
  const parsed = JSON.parse(json.stdout.trim());
  assert("activate json unread count", parsed.unread_count === 1, json.stdout);
  assert("activate json inbox available", parsed.inbox_available === true, json.stdout);
});

test("agent wait returns the current unread message", () => {
  const r = run(["agent", "wait", "--agent", "Aporta", "--timeout", "0.2", "--interval", "0.05", "--json"]);
  assert("wait status", r.status === 0, r.stderr || r.stdout);
  const parsed = JSON.parse(r.stdout.trim());
  assert("wait event message", parsed.event === "message", r.stdout);
  assert("wait recipient count", parsed.unread_count === 1, r.stdout);
  assert("wait returns messages", parsed.messages.length === 1, r.stdout);
});

test("agent watch emits each unread message once", () => {
  const r = run(["agent", "watch", "--agent", "Aporta", "--timeout", "0.16", "--interval", "0.05", "--json"]);
  assert("watch status", r.status === 0, r.stderr || r.stdout);
  const events = r.stdout.trim().split("\n").filter(Boolean).map(JSON.parse);
  const messageEvents = events.filter((item) => item.event === "message");
  assert("watch emits one message", messageEvents.length === 1, r.stdout);
  assert("watch ends on timeout", events.at(-1).event === "timeout", r.stdout);
});

test("agent wait times out with status 2 after message acknowledgement", () => {
  const inbox = run(["agent", "inbox", "--agent", "Aporta", "--json"]);
  const messageId = JSON.parse(inbox.stdout.trim()).messages[0].id;
  const ack = run(["agent", "ack", messageId, "--agent", "Aporta", "--json"]);
  assert("wait timeout seed acknowledged", ack.status === 0, ack.stderr || ack.stdout);

  const r = run(["agent", "wait", "--agent", "Aporta", "--timeout", "0.12", "--interval", "0.05", "--json"]);
  assert("wait timeout status", r.status === 2, `status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const parsed = JSON.parse(r.stdout.trim());
  assert("wait timeout event", parsed.event === "timeout" && parsed.timed_out === true, r.stdout);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
console.log("");
if (fail === 0) {
  fixtureServer.kill();
  fs.rmSync(fixtureHome, { recursive: true, force: true });
  console.log(`✓ all tests passed (${pass})`);
  process.exit(0);
} else {
  fixtureServer.kill();
  fs.rmSync(fixtureHome, { recursive: true, force: true });
  console.log(`✗ ${fail} failure(s), ${pass} passed:`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
