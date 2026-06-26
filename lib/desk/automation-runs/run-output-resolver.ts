function cleanPath(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveAutomationOutputPath(job: any, executionResult: any = {}): string | null {
  const direct = cleanPath(executionResult?.outputPath) || cleanPath(executionResult?.filePath);
  if (direct) return direct;
  const personal = cleanPath(job?.personalTask?.outputPath);
  if (personal) return personal;
  const files = Array.isArray(executionResult?.outputFiles) ? executionResult.outputFiles : [];
  return files.find((file) => typeof file === "string" && file.toLowerCase().endsWith(".md")) || null;
}
