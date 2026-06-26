import { describe, expect, it } from "vitest";
import { resolveAutomationOutputPath } from "../lib/desk/automation-runs/run-output-resolver.ts";
import { normalizeAutomationRun, redactAutomationRunText, sanitizeAutomationRunForLog } from "../lib/desk/automation-runs/run-summary.ts";

describe("resolveAutomationOutputPath", () => {
  it("prefers execution output path over personal task default", () => {
    expect(resolveAutomationOutputPath(
      { personalTask: { outputPath: "D:\\obsidian\\default.md" } },
      { outputPath: "D:\\obsidian\\run.md" },
    )).toBe("D:\\obsidian\\run.md");
  });

  it("uses personal task output path when execution result has no output", () => {
    expect(resolveAutomationOutputPath(
      { personalTask: { outputPath: "D:\\obsidian\\default.md" } },
      {},
    )).toBe("D:\\obsidian\\default.md");
  });

  it("uses first markdown output file", () => {
    expect(resolveAutomationOutputPath({}, {
      outputFiles: ["D:\\tmp\\raw.txt", "D:\\tmp\\summary.md"],
    })).toBe("D:\\tmp\\summary.md");
  });
});

describe("automation run summary", () => {
  it("redacts api keys and authorization headers", () => {
    expect(redactAutomationRunText("Authorization: Bearer abc.def\nsk-1234567890abcdef")).toBe("Authorization: Bearer [redacted]\n[redacted]");
  });

  it("redacts bearer tokens with punctuation and ignores header case", () => {
    expect(redactAutomationRunText("authorization: bearer abc.def+/tail==")).toBe("authorization: bearer [redacted]");
  });

  it("normalizes success to done and attaches job id", () => {
    const run = normalizeAutomationRun("job_1", {
      id: "cron_1",
      status: "success",
      error: "Authorization: Bearer secret.token",
    });

    expect(run).toEqual(expect.objectContaining({
      id: "cron_1",
      jobId: "job_1",
      status: "done",
      error: "Authorization: Bearer [redacted]",
    }));
  });

  it("sanitizes nested run metadata before storage", () => {
    expect(sanitizeAutomationRunForLog({
      status: "success",
      summary: "ok sk-1234567890abcdef",
      modelDecision: {
        reason: "Authorization: Bearer abc.def",
        provider: "deepseek",
      },
    })).toEqual({
      status: "success",
      summary: "ok [redacted]",
      modelDecision: {
        reason: "Authorization: Bearer [redacted]",
        provider: "deepseek",
      },
    });
  });

  it("redacts key-value secrets, provider keys, url tokens, and bare bearer tokens", () => {
    const raw = [
      "api_key: gsk_1234567890abcdefghijklmnopqrst",
      "client_secret=client-secret-value",
      "https://example.test/callback?token=url-token-value&ok=1",
      "Bearer abc.def+/tail==",
    ].join("\n");

    const redacted = redactAutomationRunText(raw);

    expect(redacted).not.toContain("gsk_1234567890abcdefghijklmnopqrst");
    expect(redacted).not.toContain("client-secret-value");
    expect(redacted).not.toContain("url-token-value");
    expect(redacted).not.toContain("abc.def+/tail==");
    expect(redacted).toContain("api_key=[redacted]");
    expect(redacted).toContain("client_secret=[redacted]");
    expect(redacted).toContain("?token=[redacted]");
    expect(redacted).toContain("Bearer [redacted]");
  });

  it("redacts structured secret fields without changing ordinary run metadata", () => {
    const sanitized = sanitizeAutomationRunForLog({
      status: "success",
      jobId: "job_1",
      outputPath: "D:\\obsidian\\out.md",
      api_key: "short-secret",
      client_secret: "client-secret-value",
      nested: {
        access_token: "access-secret-value",
        Token: "mixed-case-token",
        apiKey: "camel-secret",
        "api-key": "dash-secret",
      },
    });

    expect(sanitized).toEqual({
      status: "success",
      jobId: "job_1",
      outputPath: "D:\\obsidian\\out.md",
      api_key: "[redacted]",
      client_secret: "[redacted]",
      nested: {
        access_token: "[redacted]",
        Token: "[redacted]",
        apiKey: "[redacted]",
        "api-key": "[redacted]",
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("short-secret");
    expect(JSON.stringify(sanitized)).not.toContain("client-secret-value");
    expect(JSON.stringify(sanitized)).not.toContain("access-secret-value");
    expect(JSON.stringify(sanitized)).not.toContain("mixed-case-token");
    expect(JSON.stringify(sanitized)).not.toContain("camel-secret");
    expect(JSON.stringify(sanitized)).not.toContain("dash-secret");
  });

  it("normalizes api response without leaking nested persisted secrets", () => {
    const run = normalizeAutomationRun("job_1", {
      id: "run_secret",
      status: "success",
      summary: "access_token=access-token-value",
      outputPath: "D:\\obsidian\\out.md?token=file-token-value",
      modelDecision: {
        reason: "api_key: gsk_1234567890abcdefghijklmnopqrst",
      },
    });

    expect(JSON.stringify(run)).not.toContain("access-token-value");
    expect(JSON.stringify(run)).not.toContain("file-token-value");
    expect(JSON.stringify(run)).not.toContain("gsk_1234567890abcdefghijklmnopqrst");
  });
});
