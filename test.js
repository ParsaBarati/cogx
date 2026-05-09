// cogx CLI tests — pure Node, no test framework needed.
// Run: node test.js
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const CLI = path.join(__dirname, "index.js");
const env = { ...process.env, NO_COLOR: "1", ICOG_API_KEY: "test_dummy_key" };

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

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
console.log("");
if (fail === 0) {
  console.log(`✓ all tests passed (${pass})`);
  process.exit(0);
} else {
  console.log(`✗ ${fail} failure(s), ${pass} passed:`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
