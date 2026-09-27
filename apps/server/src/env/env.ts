import "./load-env";
import { envSchema } from "../schema/env.schema";

const parsed = envSchema.safeParse(process.env);
if (parsed.error) {
    throw new Error('Invalid env: ' + JSON.stringify(parsed.error));
}

export const env = parsed.data;