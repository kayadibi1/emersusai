# OpenAI API Reference (Responses API)

Saved 2026-04-15. Refer to this file for all AI pipeline work.
Source: https://developers.openai.com/api/reference/overview

---

## 1. Create Response Endpoint

```
POST /v1/responses
```

### Core Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | yes | Model ID (e.g. `gpt-5.4-mini`) |
| `input` | string \| array | no | Text, image, or file inputs. String = user text. Array = structured items. |
| `stream` | boolean | no | Stream the response (SSE). |
| `previous_response_id` | string | no | Chain responses across turns. |
| `max_output_tokens` | integer | no | Cap output tokens. |
| `tools` | array | no | Tool definitions the model can call. |
| `tool_choice` | string \| object | no | `"auto"`, `"required"`, `"none"`, or `{ type: "function", name: "..." }`. |
| `conversation` | string \| object | no | Persistent conversation ID. |
| `include` | array[string] | no | Extra output data (e.g. `"file_search_call.results"`). |
| `background` | boolean | no | Run in background mode. |

### Input Message Formats

```jsonc
// User message
{ "role": "user", "content": "text or [content_items]" }

// System message
{ "role": "system", "content": "..." }

// Developer message (highest precedence)
{ "role": "developer", "content": "..." }

// Function call output (multi-turn tool use)
{ "type": "function_call_output", "call_id": "call_xxx", "output": "string" }
```

Content item types: `input_text`, `input_image`, `input_file`.

### Response Object

```jsonc
{
  "id": "resp_xxx",
  "type": "response",
  "status": "completed",        // "in_progress" | "completed" | "incomplete"
  "output": [                    // array of output items
    { "type": "message", "role": "assistant", "content": [...] },
    { "type": "function_call", "id": "fc_xxx", "call_id": "call_xxx",
      "name": "get_weather", "arguments": "{...}" }
  ],
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50,
    "total_tokens": 150
  }
}
```

### Streaming Events

| Event | Description |
|-------|-------------|
| `response.started` | Response begins |
| `response.output_text.delta` | Prose text chunk (`event.delta`) |
| `response.output_item.added` | New output item (message or function_call) |
| `response.function_call_arguments.delta` | Partial function call args |
| `response.function_call_arguments.done` | Complete function call args |
| `response.output_item.done` | Output item finished |
| `response.completed` | Response complete, `event.response` has usage + id |
| `response.failed` | Response failed |

---

## 2. Function Calling (Tool Use)

### Defining Tools

```jsonc
{
  "type": "function",
  "name": "get_weather",
  "description": "Get current weather for a location.",
  "strict": true,               // recommended: enforce schema adherence
  "parameters": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City, Country" }
    },
    "required": ["location"],
    "additionalProperties": false
  }
}
```

**Strict mode requirements:**
- `additionalProperties: false` on every object
- All properties listed in `required`
- Optional fields use `"type": ["string", "null"]`

### The 5-Step Flow

1. Send request with `tools` array
2. Model returns `function_call` output items
3. Execute the function server-side
4. Send results back as `function_call_output`
5. Model continues generating (may call more tools)

### Responses API: Multi-Turn Pattern

**Option A — Accumulate input:**
```js
// After first response
inputList.push(...response.output);  // include function_call items

for (const item of response.output) {
  if (item.type === "function_call") {
    const result = callFunction(item.name, JSON.parse(item.arguments));
    inputList.push({
      type: "function_call_output",
      call_id: item.call_id,
      output: JSON.stringify(result),
    });
  }
}

// Second request with full history
const response2 = await fetch("/v1/responses", {
  body: JSON.stringify({ model, input: inputList, tools, stream: true })
});
```

**Option B — Use `previous_response_id`:**
```js
// Only send new tool outputs, reference prior context by ID
const response2 = await fetch("/v1/responses", {
  body: JSON.stringify({
    model,
    previous_response_id: firstResponse.id,
    input: [
      { type: "function_call_output", call_id: "call_xxx", output: "..." }
    ],
    tools,
    stream: true
  })
});
```

Both approaches are equivalent. Option B is simpler but still bills all prior input tokens.

### Streaming Function Calls

```
Event: response.output_item.added
  → item.type === "function_call"
  → item.call_id, item.name, item.arguments (empty initially)

Event: response.function_call_arguments.delta
  → event.delta contains partial JSON args
  → accumulate into buffer

Event: response.function_call_arguments.done
  → full arguments string available

Event: response.output_item.done
  → item complete, safe to parse arguments
```

### Tool Choice

```jsonc
"tool_choice": "auto"           // default: 0+ tool calls
"tool_choice": "required"       // 1+ tool calls mandatory
"tool_choice": "none"           // no tool calls
"tool_choice": { "type": "function", "name": "get_weather" }  // force specific
```

### Parallel Tool Calls

Models can call multiple functions in one response. Disable with `parallel_tool_calls: false`.

### Token Usage

Tool definitions are injected into the system message and billed as input tokens. Keep tool count and description length minimal.

---

## 3. Conversation State

### `previous_response_id`

Chains responses across turns. The model sees all prior context automatically.

```js
const response2 = await fetch("/v1/responses", {
  body: JSON.stringify({
    model: "gpt-5.4-mini",
    previous_response_id: response1.id,
    input: [{ role: "user", content: "explain why" }]
  })
});
```

**Billing:** All previous input tokens in the chain are billed as input tokens on every follow-up. There is no free context carry-forward.

**Retention:** Response objects saved for 30 days by default. Set `store: false` to disable.

### Conversations API (persistent)

Create a conversation object with a unique ID. Pass it to subsequent calls — the system maintains context automatically across sessions, devices, or jobs.

---

## 4. Best Practices

- Write clear tool descriptions — the model uses them to decide when to call.
- Use strict mode for reliable structured outputs.
- Keep initial tool count under 20.
- Offload burden from the model — don't make it fill args you already know.
- For functions with no return value, return `"success"` or `"failure"`.
- When using reasoning models (GPT-5, o4-mini), pass reasoning items back with tool outputs.
- For image/file returns from tools, pass an array of objects instead of a string.
