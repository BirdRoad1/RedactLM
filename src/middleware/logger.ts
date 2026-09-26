import { createMiddleware } from "hono/factory";

// Method, path, status and timing only: bodies carry prompts, passwords and API keys
export const logRequests = createMiddleware(async (c, next) => {
  const start = performance.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
});
