import z from "zod";

export const jwtSchema = z.object({
    userId: z.number().min(0)
})