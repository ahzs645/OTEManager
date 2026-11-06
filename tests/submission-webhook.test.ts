import { afterEach, expect, test, vi } from "vitest";
import { Route, secretsMatch } from "../app/routes/api/submissions";

afterEach(() => vi.unstubAllEnvs());

test("secret comparison is exact, including length", () => {
  expect(secretsMatch("s3cret", "s3cret")).toBe(true);
  expect(secretsMatch("s3cre", "s3cret")).toBe(false);
  expect(secretsMatch("s3cretX", "s3cret")).toBe(false);
  expect(secretsMatch("", "s3cret")).toBe(false);
  expect(secretsMatch("ünï", "ünï")).toBe(true);
});

test("submissions require the configured webhook secret", async () => {
  vi.stubEnv("WEBHOOK_SECRET", "expected-secret");
  const post = (Route.options as any).server.handlers.POST;
  for (const header of [undefined, "wrong", "expected-secre"]) {
    const response = await post({
      request: new Request("http://localhost/api/submissions", {
        method: "POST",
        headers: header ? { "X-Webhook-Secret": header } : {},
        body: "{}",
      }),
    });
    expect(response.status).toBe(401);
  }
});
