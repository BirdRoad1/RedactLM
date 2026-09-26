import { createMiddleware } from "hono/factory";

export const logRequests = createMiddleware(async (c, next) => {
  console.log("Request!", await c.req.text());
  await next();
});
