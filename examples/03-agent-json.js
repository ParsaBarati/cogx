#!/usr/bin/env node
// 03-agent-json.js — call cogx from a Node script using --json.
//
// Useful pattern for agents and tools that need to integrate with iCog
// without depending on an SDK. Just shell out, parse the JSON, done.
//
// Usage: ICOG_API_KEY=... node 03-agent-json.js

const { execFileSync } = require("child_process");

function cogx(args) {
  const out = execFileSync("cogx", [...args, "--json"], { encoding: "utf8" });
  const result = JSON.parse(out.trim());
  if (!result.ok) throw new Error(`cogx ${args[0]}: ${result.error}`);
  return result;
}

// Store a memory
const stored = cogx(["remember", "Agent test memory from 03-agent-json.js"]);
console.log("stored:", stored.memory_id);

// Recall it
const recalled = cogx(["recall", "agent test memory", "--limit", "3"]);
console.log(`recalled ${recalled.count} memories:`);
for (const m of recalled.memories) {
  console.log(`  [${m.memory_type}] ${m.text.slice(0, 60)}...`);
}

// Reflect on state
const state = cogx(["reflect"]);
console.log(`consciousness: ${state.consciousness_level}, memories: ${state.memory_count}`);

// Talk
const reply = cogx(["talk", "What's the most recent agent memory?"]);
console.log("icog:", reply.response.slice(0, 200));
