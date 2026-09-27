import type { CompletionsChunk } from "../schema/completion-response.schema";
import type { ToolCall } from "../schema/completions-request.schema";

export type CollectedReply = {
  id?: string;
  model?: string;
  content: string;
  toolCalls: ToolCall[];
};

// Passes SSE bytes through untouched while piecing together the assistant's
// reply (choice 0) from the chunks. `onDone` runs once the upstream stream
// ends; it doesn't run if the client disconnects first.
export function tapCompletionStream(onDone: (reply: CollectedReply) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  const reply: CollectedReply = { content: "", toolCalls: [] };

  function handleLine(line: string) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;

    let chunk: CompletionsChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }

    reply.id ??= chunk.id;
    reply.model ??= chunk.model;

    const delta = chunk.choices?.find((choice) => choice.index === 0)?.delta;
    if (!delta) return;

    if (delta.content) reply.content += delta.content;

    // tool calls arrive in fragments keyed by index, arguments split across chunks
    for (const part of delta.tool_calls ?? []) {
      const call = (reply.toolCalls[part.index] ??= {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(bytes, controller) {
      controller.enqueue(bytes);

      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // last piece may be an incomplete line
      lines.forEach(handleLine);
    },
    flush() {
      handleLine(buffer + decoder.decode());
      reply.toolCalls = reply.toolCalls.filter(Boolean);
      onDone(reply);
    },
  });
}
