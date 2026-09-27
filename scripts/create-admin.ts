// Creates the first admin (POST /users needs an admin, so it can't bootstrap
// itself). They then log in through POST /auth/login like everyone else.
// Usage: bun run create-admin <email> <username>   (prompts for the password)
import { createUserSchema } from "../src/schema/user.schema";
import { audit } from "../src/services/audit.service";
import { createUser } from "../src/services/users.service";

const [email, username] = process.argv.slice(2);
const password = prompt("Password:");

const parsed = createUserSchema.safeParse({ email, username, password, isAdmin: true });
if (parsed.error) {
  console.error("Usage: bun run create-admin <email> <username>");
  console.error(parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n"));
  process.exit(1);
}

const user = await createUser(parsed.data);
// no logged-in user here: whoever has shell access ran it
await audit("user_created", { email: user.email, isAdmin: true }, { userId: null });
console.log(`Created admin #${user.id} (${user.email})`);
process.exit(0);
