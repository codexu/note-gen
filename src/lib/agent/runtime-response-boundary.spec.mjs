import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  createToolCallExecutionGate,
  OpenAICompatibleStreamAdapter,
} from "prefix-safe-json";

const root = new URL("./", import.meta.url);
const state = () => globalThis.__noteGenFixture;

// Keep the actual runtime, context manager, permission engine, retry manager,
// queue and recorder. Only application/provider boundaries are replaced.
// No HTTP/SSE decoder, Rust/Tauri host or OpenAI SDK is part of this run.
const stubs = {
  "@/lib/ai/utils": `
    const fixture=()=>globalThis.__noteGenFixture;
    export const getAISettings=async()=>fixture().config;
    export const validateAIService=async(value)=>value;
    export const getSystemPromptContent=async()=>'';
    export const createOpenAIClient=async()=>fixture().client;
    export const createChatCompletionStreamWithToolChoiceFallback=(client,params,options)=>client.chat.completions.create(params,options);
    export const getChatTokenLimitParams=()=>({});
    export const withFastAiRequestOptions=(value)=>value;
    export const handleAIError=async(error)=>error.message;
    export const convertImageToBase64=async()=>{throw new Error('Unexpected image access')};
    export const createAssistantToolCallMessage=(content,tool_calls)=>({role:'assistant',content:content||null,tool_calls});
  `,
  "@/lib/ai/token-counter": `export const estimateTokens=(value)=>Math.ceil(value.length/4);`,
  "./event-bus": `export const agentEventBus={emit:async(name)=>{globalThis.__noteGenFixture.events.push(name)}};`,
  "./prompt-assembler": `
    export class AgentPromptAssembler{assemble(){return 'Offline fixture';}}
    export const hasInlineCurrentEditorSelection=()=>false;
    export const hasInlineCurrentEditorState=()=>false;
  `,
  "@/lib/context/loader": `export const memoryContextService={formatMemoryContext:()=>'',getMemoryContext:async()=>{throw new Error('Unexpected memory access')}};`,
  "./tool-registry": `
    export const agentToolRegistry={listTools:()=>globalThis.__noteGenFixture.tools,toOpenAITools:(tools)=>tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}))};
    export const buildEditorApprovalPreview=async()=>{throw new Error('Unexpected editor approval')};
  `,
  "@/lib/skills": `export const skillManager={getSkill:()=>{throw new Error('Unexpected skill access')}};`,
  "@/lib/mcp/agent-tools": `export const buildMcpAgentToolCatalog=()=>({directTools:[],deferredEntries:[],schemaTokens:0});`,
  "./debug-log": `export const agentDebugLog=()=>{}; export const previewText=(text)=>text;`,
  "@/lib/rag-agent-policy": `export const getRagAgentPolicy=async()=>({automaticSearchEnabled:false,strategy:'fast',maxSearchRounds:0});`,
  "@/lib/mcp/server-manager": `export const mcpServerManager={getServerTools:()=>{throw new Error('Unexpected MCP access')}};`,
  "@/stores/mcp": `export const useMcpStore={getState:()=>{throw new Error('Unexpected store access')}};`,
  "@/lib/skills/runtime": `export const getSkillScriptPermissionKey=()=>{throw new Error('Unexpected script permission')};`,
};
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("runtime.ts", root))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node22",
  plugins: [
    {
      name: "explicit-fixture-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (Object.hasOwn(stubs, args.path))
            return { path: args.path, namespace: "fixture" };
          const reviewedModules = new Set([
            "./context-manager",
            "./permission-engine",
            "./recovery-manager",
            "./pending-message-queue",
            "./trace-recorder",
          ]);
          if (args.kind === "entry-point" || reviewedModules.has(args.path))
            return;
          return {
            errors: [{ text: `Unreviewed fixture import: ${args.path}` }],
          };
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
const { AgentRuntime } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const call = (id, input) => ({
  id,
  type: "function",
  function: { name: "fixture_read", arguments: input },
});
const scenarios = [
  {
    name: "healthy one",
    calls: [call("one", '{"input":"ok"}')],
    native: 1,
    guarded: 1,
  },
  {
    name: "healthy two",
    calls: [
      call("one", '{"input":"first"}'),
      call("two", '{"input":"second"}'),
    ],
    native: 2,
    guarded: 2,
  },
  {
    name: "complete JSON with length",
    calls: [call("one", '{"input":"ok"}')],
    finish: "length",
    native: 1,
    guarded: 0,
  },
  {
    name: "complete JSON with content_filter",
    calls: [call("one", '{"input":"ok"}')],
    finish: "content_filter",
    native: 1,
    guarded: 0,
  },
  {
    name: "clean EOF without finish",
    calls: [call("one", '{"input":"ok"}')],
    eof: true,
    native: 1,
    guarded: 0,
  },
  {
    name: "duplicate original IDs",
    calls: [
      call("one", '{"input":"first"}'),
      call("one", '{"input":"second"}'),
    ],
    native: 2,
    guarded: 0,
  },
  {
    name: "malformed JSON",
    calls: [call("one", '{"input":')],
    native: 0,
    guarded: 0,
  },
  {
    name: "healthy then malformed sibling",
    calls: [call("one", '{"input":"ok"}'), call("two", '{"input":')],
    native: 1,
    guarded: 0,
  },
  {
    name: "wrong argument type",
    calls: [call("one", '{"input":42}')],
    native: 1,
    guarded: 0,
  },
  {
    name: "provider error after tool_calls finish",
    calls: [call("one", '{"input":"ok"}')],
    lateError: true,
    native: 1,
    guarded: 0,
  },
  {
    name: "transport throws after arguments",
    calls: [call("one", '{"input":"ok"}')],
    transportError: true,
    native: 0,
    guarded: 0,
  },
  {
    name: "user stop after arguments",
    calls: [call("one", '{"input":"ok"}')],
    stop: true,
    native: 0,
    guarded: 0,
  },
];
function chunks(scenario, followup) {
  const base = {
    id: "fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture-model",
  };
  const data = followup
    ? { role: "assistant", content: "finished" }
    : {
        role: "assistant",
        tool_calls: scenario.calls.map((c, index) => ({ ...c, index })),
      };
  const result = [
    { ...base, choices: [{ index: 0, finish_reason: null, delta: data }] },
  ];
  if (followup || !scenario.eof)
    result.push({
      ...base,
      choices: [
        {
          index: 0,
          finish_reason: followup ? "stop" : (scenario.finish ?? "tool_calls"),
          delta: {},
        },
      ],
    });
  if (!followup && scenario.lateError)
    result.push({
      error: { message: "Fixture provider failure", type: "fixture_error" },
    });
  return result;
}
function preflight(events, params) {
  const schemas = Object.fromEntries(
    params.tools.map((t) => [t.function.name, t.function.parameters]),
  );
  const gate = createToolCallExecutionGate(undefined, undefined, schemas);
  const adapter = new OpenAICompatibleStreamAdapter();
  for (const chunk of events)
    for (const event of adapter.push(chunk)) gate.push(event);
  for (const event of adapter.finish()) gate.push(event);
  const result = gate.finish();
  assert.ok(
    result.decisions.every((d) => d.action === "execute"),
    `Fixture boundary refusal: ${result.decisions.map((d) => d.reason).join(",")}`,
  );
  return result.decisions.map((decision) => ({ decision, gate }));
}
for (const scenario of scenarios)
  for (const guarded of [false, true])
    test(`${scenario.name} / ${guarded ? "PSJ policy" : "native"}`, async (context) => {
      const effects = [],
        requests = [],
        events = [];
      let authorities = [],
        consumed = 0,
        error,
        result;
      const runtime = new AgentRuntime();
      const tool = {
        name: "fixture_read",
        title: "Fixture read",
        description: "Return an in-memory fixture value",
        category: "system",
        risk: "read",
        inputSchema: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
          additionalProperties: false,
        },
        execute: async (args) => {
          if (guarded) {
            const entry = authorities.shift();
            assert.ok(entry);
            const authority = entry.gate.takeDecision(
              entry.decision.internalId,
            );
            assert.ok(authority);
            assert.equal(authority.name, "fixture_read");
            assert.equal(
              authority.toolCallId,
              scenario.calls[effects.length].id,
            );
            assert.deepEqual(authority.value, args);
            assert.equal(
              entry.gate.takeDecision(entry.decision.internalId),
              undefined,
            );
            consumed++;
          }
          effects.push(structuredClone(args));
          return { ok: true, message: "recorded", data: args };
        },
      };
      const client = {
        chat: {
          completions: {
            create: async (params) => {
              requests.push(structuredClone(params));
              assert.ok(requests.length <= 2, "Unexpected continuation");
              const followup = requests.length === 2;
              const response = chunks(scenario, followup);
              return (async function* () {
                // A finite, synchronous preflight is an optional comparison, not a
                // production transport wrapper. Stop/read errors remain iterator failures.
                if (guarded && !scenario.stop && !scenario.transportError)
                  authorities = preflight(response, params);
                yield structuredClone(response[0]);
                if (!followup && scenario.stop) {
                  runtime.stop();
                  return;
                }
                if (!followup && scenario.transportError)
                  throw new Error("Fixture transport failure");
                for (const chunk of response.slice(1))
                  yield structuredClone(chunk);
              })();
            },
          },
        },
      };
      globalThis.__noteGenFixture = {
        config: { baseURL: "https://fixture.invalid", model: "fixture-model" },
        client,
        tools: [tool],
        events,
      };
      const savedFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("Unexpected network access");
      };
      try {
        result = await runtime.run({
          userInput: "Read the fixture",
          aiConfig: state().config,
          useMemories: false,
          permissionMode: "read-only",
        });
      } catch (reason) {
        error = reason;
      } finally {
        globalThis.fetch = savedFetch;
        delete globalThis.__noteGenFixture;
      }
      const expected = guarded ? scenario.guarded : scenario.native;
      const preservesExistingControl =
        ["healthy one", "healthy two", "malformed JSON"].includes(
          scenario.name,
        ) ||
        scenario.stop ||
        scenario.transportError;
      if (guarded || preservesExistingControl) {
        assert.equal(effects.length, expected);
      }
      assert.equal(consumed, guarded ? expected : 0);
      context.diagnostic(
        JSON.stringify({
          scenario: scenario.name,
          guarded,
          callbacks: effects.length,
          requests: requests.length,
          error: error?.message,
        }),
      );
      if (scenario.stop) {
        assert.equal(error, undefined);
        assert.equal(result.stopped, true);
        assert.equal(requests.length, 1);
      } else if (scenario.transportError) {
        assert.match(error.message, /Fixture transport failure/);
        assert.equal(requests.length, 1);
      } else if (guarded && !expected) {
        assert.match(error.message, /Fixture boundary refusal/);
        assert.equal(requests.length, 1);
      } else if (!guarded && error) {
        // Native refusal is an acceptable improvement. A differential evaluation
        // must not freeze today's permissive behavior as a required app contract.
        assert.equal(effects.length, 0);
        assert.equal(requests.length, 1);
      } else {
        assert.equal(error, undefined);
        assert.equal(result.content, "finished");
        assert.equal(requests.length, 2);
        const outputs = requests[1].messages.filter((m) => m.role === "tool");
        assert.deepEqual(
          outputs.map((m) => m.tool_call_id),
          scenario.calls.map((c) => c.id),
        );
        assert.equal(
          outputs.filter((m) => JSON.parse(m.content).ok).length,
          effects.length,
        );
      }
      if (scenario.name === "healthy one")
        assert.deepEqual(effects, [{ input: "ok" }]);
      if (scenario.name === "healthy two")
        assert.deepEqual(effects, [{ input: "first" }, { input: "second" }]);
    });
