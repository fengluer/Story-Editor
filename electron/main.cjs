const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const READ_CLIPBOARD_CHANNEL = "story-editor:read-clipboard-text";
const SAVE_FILE_CHANNEL = "story-editor:save-file";
const FOCUS_WINDOW_CHANNEL = "story-editor:focus-window";
const AI_STATUS_CHANNEL = "story-editor:ai-status";
const AI_SAVE_KEY_CHANNEL = "story-editor:ai-save-key";
const AI_GENERATE_CHANNEL = "story-editor:ai-generate";
const AI_CREDENTIALS_FILE = "ai-credentials.json";
const AI_BASE_OUTPUT_TOKENS = 4096;
const AI_REQUEST_TIMEOUT_MS = 180000;

function focusWindow(window) {
  if (!window) {
    return;
  }

  window.show();
  window.focus();
  window.webContents.focus();
}

function bufferFromPayload(payload) {
  const data = payload?.data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) {
    return Buffer.from(data);
  }
  if (typeof data === "string") {
    return Buffer.from(data, payload.encoding === "base64" ? "base64" : "utf8");
  }
  throw new Error("Unsupported file data");
}

function aiCredentialsPath() {
  return path.join(app.getPath("userData"), AI_CREDENTIALS_FILE);
}

function normalizeProviderId(value) {
  const providerId = String(value || "").trim();
  if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) {
    throw new Error("Invalid AI provider ID");
  }
  return providerId;
}

async function readAiCredentials() {
  try {
    const stored = JSON.parse(await fs.readFile(aiCredentialsPath(), "utf8"));
    if (stored?.keys && typeof stored.keys === "object") {
      return { version: 2, keys: stored.keys };
    }
    if (stored?.encryptedApiKey) {
      return { version: 2, keys: { openai: stored.encryptedApiKey } };
    }
    return { version: 2, keys: {} };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 2, keys: {} };
    }
    throw error;
  }
}

async function readAiApiKey(providerId) {
  if (!safeStorage.isEncryptionAvailable()) {
    return "";
  }
  const stored = await readAiCredentials();
  const encrypted = stored.keys[normalizeProviderId(providerId)];
  return encrypted ? safeStorage.decryptString(Buffer.from(encrypted, "base64")) : "";
}

async function saveAiApiKey(providerId, apiKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("System encryption is unavailable; the API key was not saved");
  }
  const cleanProviderId = normalizeProviderId(providerId);
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) {
    const stored = await readAiCredentials();
    return { saved: false, configuredProviderIds: Object.keys(stored.keys) };
  }
  const encryptedApiKey = safeStorage.encryptString(cleanKey).toString("base64");
  const stored = await readAiCredentials();
  stored.keys[cleanProviderId] = encryptedApiKey;
  await fs.mkdir(path.dirname(aiCredentialsPath()), { recursive: true });
  await fs.writeFile(aiCredentialsPath(), JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
  return { saved: true, configuredProviderIds: Object.keys(stored.keys) };
}

function validateAiBaseURL(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ""));
  } catch {
    throw new Error("Invalid AI Base URL");
  }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLocal)) {
    throw new Error("AI Base URL must use HTTPS, except for localhost");
  }
  return endpoint;
}

function buildAiEndpoint(value, protocol) {
  const endpoint = validateAiBaseURL(value);
  const suffix = protocol === "openai-chat" ? "/chat/completions" : "/responses";
  const pathname = endpoint.pathname.replace(/\/+$/, "").replace(/\/(?:responses|chat\/completions)$/i, "");
  endpoint.pathname = pathname.endsWith(suffix) ? pathname : `${pathname}${suffix}`;
  return endpoint.toString();
}

function parseStructuredJson(value) {
  const clean = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}

function debugAiResponse(providerId, protocol, model, response, data, attempt) {
  if (!isDev) {
    return;
  }
  const safeData = data == null ? data : JSON.parse(JSON.stringify(data, (key, value) => (
    key === "encrypted_content" && typeof value === "string"
      ? `[encrypted reasoning content: ${value.length} characters]`
      : value
  )));
  console.dir(
    {
      providerId,
      protocol,
      model,
      attempt,
      httpStatus: response.status,
      response: safeData,
    },
    { depth: null },
  );
}

function responseOutputText(data, protocol) {
  return protocol === "openai-chat"
    ? data?.choices?.[0]?.message?.content
    : typeof data?.output_text === "string"
      ? data.output_text
      : data?.output
          ?.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
          .filter((item) => item?.type === "output_text" && typeof item.text === "string")
          .map((item) => item.text)
          .join("");
}

async function readAiResponseBody(response) {
  if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    return readAiStreamBody(response);
  }
  const rawText = await response.text().catch(() => "");
  if (!rawText) {
    return { data: null, rawText: "" };
  }
  try {
    return { data: JSON.parse(rawText), rawText };
  } catch {
    return { data: null, rawText };
  }
}

async function readAiStreamBody(response) {
  if (!response.body) {
    return { data: null, rawText: "AI stream returned no response body" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let finalData = null;
  let lastError = null;

  const consumeEvent = (block) => {
    const dataText = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!dataText || dataText === "[DONE]") {
      return;
    }
    let event;
    try {
      event = JSON.parse(dataText);
    } catch {
      return;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      outputText += event.delta;
    } else if (event.type === "response.output_text.done" && !outputText && typeof event.text === "string") {
      outputText = event.text;
    }
    if (["response.completed", "response.incomplete", "response.failed"].includes(event.type) && event.response) {
      finalData = event.response;
    }
    if (event.type === "error") {
      lastError = event.error || event;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consumeEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    consumeEvent(buffer);
  }
  if (lastError && !finalData) {
    return { data: { error: lastError }, rawText: JSON.stringify(lastError) };
  }
  const data = finalData || (outputText ? { status: "completed", output_text: outputText, output: [] } : null);
  if (data && outputText && typeof data.output_text !== "string") {
    data.output_text = outputText;
  }
  return { data, rawText: outputText };
}

function summarizeHttpErrorBody(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return "";
  }
  if (/<html[\s>]/i.test(text) && /cloudflare/i.test(text)) {
    const title = text.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || "Cloudflare error";
    const host = text.match(/<span[^>]*>\s*([^<\s]+)\s*<\/span>\s*<h3[^>]*>\s*Host\s*<\/h3>[\s\S]*?Host\s*<\/h3>/i)?.[1]
      || text.match(/utm_campaign=([^&"']+)/i)?.[1]
      || "upstream host";
    const rayId = text.match(/Cloudflare Ray ID:\s*<strong[^>]*>([^<]+)<\/strong>/i)?.[1]?.trim();
    return `${title}；Cloudflare 正常，但 ${host} 源站 Host Error${rayId ? `；Ray ID: ${rayId}` : ""}`;
  }
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function aiHttpError(data, status, action = "AI request", rawText = "") {
  const cloudflareDetail = data?.cloudflare_error
    ? `${data.title || "Cloudflare error"}；${data.detail || "源站返回无效响应"}；zone=${data.zone || "unknown"}；Ray ID=${data.ray_id || data.instance || "unknown"}；retry_after=${Number(data.retry_after) || 60}`
    : "";
  const detail = data?.error?.message || cloudflareDetail || summarizeHttpErrorBody(rawText);
  if (status === 429) {
    return new Error(`AI 请求受到限流（429）${detail ? `：${detail}` : "，请稍后重试"}`);
  }
  if (status >= 500) {
    return new Error(`AI 服务暂时不可用（${status}）${detail ? `：${detail}` : "，可以重试"}`);
  }
  if (status === 401 || status === 403) {
    return new Error(`AI 鉴权失败（${status}）${detail ? `：${detail}` : "，请检查 API Key 和模型权限"}`);
  }
  return new Error(detail || `${action} failed (${status})`);
}

function throwAiStreamError(data) {
  if (!data?.error) {
    return;
  }
  const error = data.error;
  throw new Error(error.message || error.code || "AI stream failed before producing output");
}

function shouldFallbackFromStream(response, rawText) {
  void rawText;
  if ([400, 404, 405, 415, 422].includes(response.status)) {
    return true;
  }
  return false;
}

async function requestAiResponse(payload) {
  const providerId = normalizeProviderId(payload?.providerId);
  const protocol = payload?.protocol === "openai-chat" ? "openai-chat" : "openai-responses";
  const requiresApiKey = payload?.requiresApiKey !== false;
  const apiKey = await readAiApiKey(providerId);
  if (requiresApiKey && !apiKey) {
    throw new Error(`请先在 AI 设定中配置 ${providerId} 的 API Key`);
  }
  const endpoint = buildAiEndpoint(payload?.baseURL, protocol);
  const model = String(payload?.model || "").trim();
  const instructions = String(payload?.instructions || "").trim();
  const input = String(payload?.input || "").trim();
  const schemaName = String(payload?.schemaName || "story_result").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const schema = payload?.schema;
  if (!model || !instructions || !input || !schema || typeof schema !== "object") {
    throw new Error("AI request is incomplete");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    if (protocol === "openai-responses") {
      headers.Accept = "text/event-stream";
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const useGpt56Parameters = providerId === "openai" && /^gpt-5\.6(?:-|$)/i.test(model);
    const supportedReasoningEfforts = new Set(["none", "low", "medium", "high", "xhigh"]);
    const reasoningEffort = supportedReasoningEfforts.has(payload?.reasoningEffort) ? payload.reasoningEffort : "medium";
    const useReasoningEffort = payload?.supportsReasoningEffort === true;
    const outputTokenBudgets = {
      none: AI_BASE_OUTPUT_TOKENS,
      low: 8192,
      medium: 16384,
      high: 32768,
      xhigh: 65536,
    };
    const maxOutputTokens = useReasoningEffort ? outputTokenBudgets[reasoningEffort] : AI_BASE_OUTPUT_TOKENS;
    const requestBody = protocol === "openai-chat"
      ? {
          model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: input },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: schemaName || "story_result", strict: true, schema },
          },
          ...(useGpt56Parameters
            ? { max_completion_tokens: maxOutputTokens, verbosity: "low" }
            : { max_tokens: maxOutputTokens }),
          ...(useReasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }
      : {
          model,
          instructions,
          input,
          stream: true,
          store: false,
          max_output_tokens: maxOutputTokens,
          ...(useGpt56Parameters ? {
            include: ["reasoning.encrypted_content"],
          } : {}),
          ...(useReasoningEffort ? {
            reasoning: { effort: reasoningEffort, ...(useGpt56Parameters ? { context: "current_turn" } : {}) },
          } : {}),
          text: {
            ...(useGpt56Parameters ? { verbosity: "low" } : {}),
            format: {
              type: "json_schema",
              name: schemaName || "story_result",
              strict: true,
              schema,
            },
          },
        };
    let response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    let responseBody = await readAiResponseBody(response);
    let data = responseBody.data;
    debugAiResponse(providerId, protocol, model, response, data ?? summarizeHttpErrorBody(responseBody.rawText), 1);
    if (!response.ok && protocol === "openai-responses" && requestBody.stream === true && shouldFallbackFromStream(response, responseBody.rawText)) {
      requestBody.stream = false;
      headers.Accept = "application/json";
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      responseBody = await readAiResponseBody(response);
      data = responseBody.data;
      debugAiResponse(providerId, protocol, model, response, data ?? summarizeHttpErrorBody(responseBody.rawText), "1-nonstream-fallback");
    }
    if (!response.ok) {
      throw aiHttpError(data, response.status, "AI request", responseBody.rawText);
    }
    throwAiStreamError(data);
    let responseProtocol = protocol;
    let outputText = responseOutputText(data, responseProtocol);
    let encryptedReasoningItems = protocol === "openai-responses" && Array.isArray(data?.output)
      ? data.output.filter((item) => item?.type === "reasoning" && typeof item.encrypted_content === "string")
      : [];
    let continuationAttempt = 1;
    const continuationLimit = 3;
    while (!outputText && encryptedReasoningItems.length > 0 && continuationAttempt < continuationLimit) {
      continuationAttempt += 1;
      const continuationInput = [
        { role: "user", content: input },
        ...encryptedReasoningItems,
        { role: "user", content: "Return the final JSON object now, matching the required schema exactly. Do not return reasoning-only output." },
      ];
      const retryBody = {
        ...requestBody,
        input: continuationInput,
        max_output_tokens: maxOutputTokens,
      };
      delete retryBody.include;
      retryBody.reasoning = requestBody.reasoning;
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(retryBody),
        signal: controller.signal,
      });
      responseBody = await readAiResponseBody(response);
      data = responseBody.data;
      debugAiResponse(providerId, protocol, model, response, data ?? summarizeHttpErrorBody(responseBody.rawText), continuationAttempt);
      if (!response.ok) {
        throw aiHttpError(data, response.status, "AI continuation", responseBody.rawText);
      }
      throwAiStreamError(data);
      outputText = responseOutputText(data, responseProtocol);
      encryptedReasoningItems = Array.isArray(data?.output)
        ? data.output.filter((item) => item?.type === "reasoning" && typeof item.encrypted_content === "string")
        : [];
    }
    if (!outputText && protocol === "openai-responses" && !useGpt56Parameters) {
      responseProtocol = "openai-chat";
      const chatEndpoint = buildAiEndpoint(payload?.baseURL, responseProtocol);
      const chatBody = {
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName || "story_result", strict: true, schema },
        },
        ...(useGpt56Parameters
          ? { max_completion_tokens: maxOutputTokens, verbosity: "low" }
          : { max_tokens: maxOutputTokens }),
        ...(useReasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      };
      response = await fetch(chatEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(chatBody),
        signal: controller.signal,
      });
      responseBody = await readAiResponseBody(response);
      data = responseBody.data;
      const fallbackAttempt = continuationAttempt + 1;
      debugAiResponse(providerId, responseProtocol, model, response, data ?? summarizeHttpErrorBody(responseBody.rawText), fallbackAttempt);
      if (!response.ok) {
        throw aiHttpError(data, response.status, "AI Chat fallback", responseBody.rawText);
      }
      throwAiStreamError(data);
      outputText = responseOutputText(data, responseProtocol);
      let chatContinuationAttempt = fallbackAttempt;
      let chatMessages = chatBody.messages;
      while (!outputText && data?.choices?.[0]?.message?.reasoning_content && chatContinuationAttempt < fallbackAttempt + 2) {
        chatContinuationAttempt += 1;
        const assistantMessage = data.choices[0].message;
        chatMessages = [
          ...chatMessages,
          {
            role: "assistant",
            content: assistantMessage.content || "",
            reasoning_content: assistantMessage.reasoning_content,
          },
          { role: "user", content: "Return only the final JSON object matching the required schema. Do not provide more reasoning." },
        ];
        response = await fetch(chatEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...chatBody, messages: chatMessages }),
          signal: controller.signal,
        });
        responseBody = await readAiResponseBody(response);
        data = responseBody.data;
        debugAiResponse(providerId, responseProtocol, model, response, data ?? summarizeHttpErrorBody(responseBody.rawText), chatContinuationAttempt);
        if (!response.ok) {
          throw aiHttpError(data, response.status, "AI Chat continuation", responseBody.rawText);
        }
        throwAiStreamError(data);
        outputText = responseOutputText(data, responseProtocol);
      }
    }
    const refusal = responseProtocol === "openai-chat"
      ? data?.choices?.[0]?.message?.refusal
      : data?.output
          ?.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
          .find((item) => item?.type === "refusal")?.refusal;
    if (refusal) {
      throw new Error(`AI refused the request: ${refusal}`);
    }
    if (!outputText) {
      const responseStatus = data?.status || data?.choices?.[0]?.finish_reason || "unknown";
      const incompleteReason = data?.incomplete_details?.reason;
      const outputTypes = Array.isArray(data?.output) ? data.output.map((item) => item?.type || "unknown").join(", ") : "none";
      const details = [
        `status=${responseStatus}`,
        incompleteReason ? `reason=${incompleteReason}` : "",
        responseProtocol === "openai-responses" ? `output=${outputTypes}` : "",
      ].filter(Boolean).join(", ");
      const guidance = useGpt56Parameters && encryptedReasoningItems.length > 0
        ? `模型 ${model} 连续 ${continuationLimit} 次只返回推理内容，没有返回最终 JSON。已停止继续累积推理，避免上下文膨胀和额外费用；可以自动重试一次，若持续失败请更换上帝模型。`
        : `模型 ${model} 没有返回结构化正文（${details}）。可以重试；原始响应见 electron:dev 终端。`;
      throw new Error(guidance);
    }
    return parseStructuredJson(outputText);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`AI 请求在 ${AI_REQUEST_TIMEOUT_MS / 1000} 秒后超时，可以重试`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#f3f5f8",
    title: "Story Editor",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);

  if (isDev) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle(READ_CLIPBOARD_CHANNEL, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    focusWindow(window);
    return clipboard.readText();
  });
  ipcMain.handle(SAVE_FILE_CHANNEL, async (event, payload) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      defaultPath: payload?.fileName || "story.csv",
      filters: payload?.filters || [],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      focusWindow(window);
      return { saved: false, canceled: true };
    }

    await fs.writeFile(result.filePath, bufferFromPayload(payload));
    focusWindow(window);
    return { saved: true, filePath: result.filePath };
  });
  ipcMain.handle(FOCUS_WINDOW_CHANNEL, (event) => {
    focusWindow(BrowserWindow.fromWebContents(event.sender));
    return true;
  });
  ipcMain.handle(AI_STATUS_CHANNEL, async () => ({
    available: true,
    configuredProviderIds: Object.keys((await readAiCredentials()).keys),
    message: safeStorage.isEncryptionAvailable() ? undefined : "System encryption is unavailable",
  }));
  ipcMain.handle(AI_SAVE_KEY_CHANNEL, (_event, payload) => saveAiApiKey(payload?.providerId, payload?.apiKey));
  ipcMain.handle(AI_GENERATE_CHANNEL, (_event, payload) => requestAiResponse(payload));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
