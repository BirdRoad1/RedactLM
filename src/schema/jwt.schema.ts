import z from "zod";

export const jwtSchema = z.object({
    userId: z.number().min(0),
    iat: z.number(), // issued at, in seconds (set by jsonwebtoken)
})