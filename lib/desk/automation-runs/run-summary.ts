const REDACTED = "[redacted]";
const SECRET_KEY_PATTERN = "api[_-]?key|apikey|api-key|secret[_-]?key|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|bot[_-]?token|server[_-]?token";
const SECRET_ASSIGN_RE = new RegExp(`\\b(${SECRET_KEY_PATTERN})\\b\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,"'\\]}]+)`, "gi");
const URL_SECRET_QUERY_RE = /([?&](?:token|access_token|refresh_token|auth|authorization|api_key|apikey|api-key|key|secret|password|client_secret|code)=)([^&#\s]+)/gi;
const PROVIDER_KEY_RE = /\b(sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|gsk_[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|xox[abpors]-[A-Za-z0-9-]+)\b/g;
const LONG_RANDOM_RE = /(^|[^\w/.-])([A-Za-z0-9+/_=-]{40,})(?=$|[^\w/.-])/g;
const SENSITIVE_OBJECT_KEY_RE = /^(api[_-]?key|apikey|api-key|secret[_-]?key|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|bot[_-]?token|server[_-]?token)$/i;

export function redactAutomationRunText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(URL_SECRET_QUERY_RE, "$1[redacted]")
    .replace(/\b(Authorization\s*[:=]\s*Bearer\s+)[^\s\r\n,;]+/gi, "$1[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[redacted]")
    .replace(SECRET_ASSIGN_RE, (_match, key) => `${key}=[redacted]`)
    .replace(PROVIDER_KEY_RE, REDACTED)
    .replace(LONG_RANDOM_RE, (_match, prefix) => `${prefix}${REDACTED}`);
}

export function sanitizeAutomationRunForLog(value: any): any {
  if (typeof value === "string") {
    return redactAutomationRunText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeAutomationRunForLog(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_OBJECT_KEY_RE.test(key) ? REDACTED : sanitizeAutomationRunForLog(item),
      ]),
    );
  }
  return value;
}

function normalizeStatus(status: unknown) {
  if (status === "success" || status === "done") return "done";
  if (status === "running" || status === "error" || status === "skipped") return status;
  return "error";
}

export function normalizeAutomationRun(jobId: string, raw: any) {
  return {
    ...sanitizeAutomationRunForLog(raw || {}),
    id: typeof raw?.id === "string" ? raw.id : `${jobId}_${raw?.timestamp || Date.now()}`,
    jobId,
    status: normalizeStatus(raw?.status),
    summary: redactAutomationRunText(raw?.summary),
    error: redactAutomationRunText(raw?.error),
  };
}
