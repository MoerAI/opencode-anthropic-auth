// src/constants.ts
var CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
var AUTHORIZE_URLS = {
  console: "https://platform.claude.com/oauth/authorize",
  max: "https://claude.ai/oauth/authorize"
};
var CODE_CALLBACK_URL = "https://platform.claude.com/oauth/code/callback";
var TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
var OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload"
];
var TOOL_PREFIX = "mcp_";
var REQUIRED_BETAS = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14"
];

// src/pkce.ts
function base64UrlEncode(bytes) {
  let bin = "";
  for (const byte of bytes)
    bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function generatePKCE() {
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  const verifier = base64UrlEncode(buf);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return {
    verifier,
    challenge: base64UrlEncode(new Uint8Array(digest)),
    method: "S256"
  };
}

// src/auth.ts
function generateState() {
  return crypto.randomUUID().replace(/-/g, "");
}
function parseCallbackInput(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const code2 = url.searchParams.get("code");
    const state2 = url.searchParams.get("state");
    if (code2 && state2) {
      return { code: code2, state: state2 };
    }
  } catch {}
  const hashSplits = trimmed.split("#");
  if (hashSplits.length === 2 && hashSplits[0] && hashSplits[1]) {
    return { code: hashSplits[0], state: hashSplits[1] };
  }
  const params = new URLSearchParams(trimmed);
  const code = params.get("code");
  const state = params.get("state");
  if (code && state) {
    return { code, state };
  }
  return null;
}
async function exchangeCode(callback, verifier, redirectUri) {
  const result = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "claude-cli/2.1.2 (external, cli)"
    },
    body: new URLSearchParams({
      code: callback.code,
      state: callback.state,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: verifier
    }).toString()
  });
  if (!result.ok) {
    return {
      type: "failed"
    };
  }
  const json = await result.json();
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000
  };
}
async function authorize(mode) {
  const pkce = await generatePKCE();
  const state = generateState();
  const url = new URL(AUTHORIZE_URLS[mode], import.meta.url);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CODE_CALLBACK_URL);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return {
    url: url.toString(),
    redirectUri: CODE_CALLBACK_URL,
    state,
    verifier: pkce.verifier
  };
}
async function exchange(input, verifier, redirectUri, expectedState) {
  const callback = parseCallbackInput(input);
  if (!callback) {
    return {
      type: "failed"
    };
  }
  if (expectedState && callback.state !== expectedState) {
    return {
      type: "failed"
    };
  }
  return exchangeCode(callback, verifier, redirectUri);
}

// src/transform.ts
function mergeHeaders(input, init) {
  const headers = new Headers;
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  const initHeaders = init?.headers;
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    } else if (Array.isArray(initHeaders)) {
      for (const entry of initHeaders) {
        const [key, value] = entry;
        if (typeof value !== "undefined") {
          headers.set(key, String(value));
        }
      }
    } else {
      for (const [key, value] of Object.entries(initHeaders)) {
        if (typeof value !== "undefined") {
          headers.set(key, String(value));
        }
      }
    }
  }
  return headers;
}
function mergeBetaHeaders(headers) {
  const incomingBeta = headers.get("anthropic-beta") || "";
  const incomingBetasList = incomingBeta.split(",").map((b) => b.trim()).filter(Boolean);
  return [...new Set([...REQUIRED_BETAS, ...incomingBetasList])].join(",");
}
function setOAuthHeaders(headers, accessToken) {
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("anthropic-beta", mergeBetaHeaders(headers));
  headers.set("user-agent", "claude-cli/2.1.2 (external, cli)");
  headers.delete("x-api-key");
  return headers;
}
function prefixToolNames(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed.tools && Array.isArray(parsed.tools)) {
      parsed.tools = parsed.tools.map((tool) => ({
        ...tool,
        name: tool.name ? `${TOOL_PREFIX}${tool.name}` : tool.name
      }));
    }
    if (parsed.messages && Array.isArray(parsed.messages)) {
      parsed.messages = parsed.messages.map((msg) => {
        if (msg.content && Array.isArray(msg.content)) {
          msg.content = msg.content.map((block) => {
            if (block.type === "tool_use" && block.name) {
              return {
                ...block,
                name: `${TOOL_PREFIX}${block.name}`
              };
            }
            return block;
          });
        }
        return msg;
      });
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}
function stripToolPrefix(text) {
  return text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"');
}
function isInsecure() {
  if (!process.env.ANTHROPIC_BASE_URL?.trim())
    return false;
  const raw = process.env.ANTHROPIC_INSECURE?.trim();
  return raw === "1" || raw === "true";
}
function resolveBaseUrl() {
  const raw = process.env.ANTHROPIC_BASE_URL?.trim();
  if (!raw)
    return null;
  try {
    const baseUrl = new URL(raw);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
      return null;
    }
    return baseUrl;
  } catch {
    return null;
  }
}
function rewriteUrl(input) {
  let requestUrl = null;
  try {
    if (typeof input === "string" || input instanceof URL) {
      requestUrl = new URL(input.toString());
    } else if (input instanceof Request) {
      requestUrl = new URL(input.url);
    }
  } catch {
    requestUrl = null;
  }
  if (!requestUrl)
    return { input, url: null };
  const originalHref = requestUrl.href;
  const baseUrl = resolveBaseUrl();
  if (baseUrl) {
    requestUrl.protocol = baseUrl.protocol;
    requestUrl.host = baseUrl.host;
  }
  if (requestUrl.pathname === "/v1/messages" && !requestUrl.searchParams.has("beta")) {
    requestUrl.searchParams.set("beta", "true");
  }
  if (requestUrl.href === originalHref) {
    return { input, url: requestUrl };
  }
  const newInput = input instanceof Request ? new Request(requestUrl.toString(), input) : requestUrl;
  return { input: newInput, url: requestUrl };
}
function createStrippedStream(response) {
  if (!response.body)
    return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder;
  const encoder = new TextEncoder;
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      let text = decoder.decode(value, { stream: true });
      text = stripToolPrefix(text);
      controller.enqueue(encoder.encode(text));
    }
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

// src/index.ts
var AnthropicAuthPlugin = async ({ client }) => {
  return {
    "experimental.chat.system.transform": (input, output) => {
      const prefix = "You are Claude Code, Anthropic's official CLI for Claude.";
      if (input.model?.providerID === "anthropic") {
        output.system.unshift(prefix);
        if (output.system[1])
          output.system[1] = `${prefix}

${output.system[1]}`;
      }
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth();
        if (auth.type === "oauth") {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0
              }
            };
          }
          let refreshPromise = null;
          return {
            apiKey: "",
            async fetch(input, init) {
              const auth2 = await getAuth();
              if (auth2.type !== "oauth")
                return fetch(input, init);
              if (!auth2.access || !auth2.expires || auth2.expires < Date.now()) {
                if (!refreshPromise) {
                  refreshPromise = (async () => {
                    const maxRetries = 2;
                    const baseDelayMs = 500;
                    for (let attempt = 0;attempt <= maxRetries; attempt++) {
                      try {
                        if (attempt > 0) {
                          const delay = baseDelayMs * 2 ** (attempt - 1);
                          await new Promise((resolve) => setTimeout(resolve, delay));
                        }
                        const response2 = await fetch(TOKEN_URL, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "User-Agent": "claude-cli/2.1.2 (external, cli)"
                          },
                          body: new URLSearchParams({
                            grant_type: "refresh_token",
                            refresh_token: auth2.refresh,
                            client_id: CLIENT_ID
                          }).toString()
                        });
                        if (!response2.ok) {
                          if (response2.status >= 500 && attempt < maxRetries) {
                            await response2.body?.cancel();
                            continue;
                          }
                          throw new Error(`Token refresh failed: ${response2.status}`);
                        }
                        const json = await response2.json();
                        await client.auth.set({
                          path: {
                            id: "anthropic"
                          },
                          body: {
                            type: "oauth",
                            refresh: json.refresh_token,
                            access: json.access_token,
                            expires: Date.now() + json.expires_in * 1000
                          }
                        });
                        return json.access_token;
                      } catch (error) {
                        const isNetworkError = error instanceof Error && (error.message.includes("fetch failed") || ("code" in error) && (error.code === "ECONNRESET" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "UND_ERR_CONNECT_TIMEOUT"));
                        if (attempt < maxRetries && isNetworkError) {
                          continue;
                        }
                        throw error;
                      }
                    }
                    throw new Error("Token refresh exhausted all retries");
                  })().finally(() => {
                    refreshPromise = null;
                  });
                }
                auth2.access = await refreshPromise;
              }
              const requestHeaders = mergeHeaders(input, init);
              setOAuthHeaders(requestHeaders, auth2.access);
              let body = init?.body;
              if (body && typeof body === "string") {
                body = prefixToolNames(body);
              }
              const rewritten = rewriteUrl(input);
              const response = await fetch(rewritten.input, {
                ...init,
                body,
                headers: requestHeaders,
                ...isInsecure() && { tls: { rejectUnauthorized: false } }
              });
              return createStrippedStream(response);
            }
          };
        }
        return {};
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const result = await authorize("max");
            return {
              url: result.url,
              instructions: "Paste the authorization code here:",
              method: "code",
              callback: async (code) => {
                return exchange(code, result.verifier, result.redirectUri, result.state);
              }
            };
          }
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const result = await authorize("console");
            return {
              url: result.url,
              instructions: "Paste the authorization code here:",
              method: "code",
              callback: async (code) => {
                const credentials = await exchange(code, result.verifier, result.redirectUri, result.state);
                if (credentials.type === "failed")
                  return credentials;
                const apiKey = await fetch(`https://api.anthropic.com/api/oauth/claude_cli/create_api_key`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    authorization: `Bearer ${credentials.access}`
                  }
                }).then((r) => r.json());
                return { type: "success", key: apiKey.raw_key };
              }
            };
          }
        },
        {
          provider: "anthropic",
          label: "Manually enter API Key",
          type: "api"
        }
      ]
    }
  };
};
export {
  AnthropicAuthPlugin
};
