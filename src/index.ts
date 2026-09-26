import { Hono } from 'hono';
import { runStaticChecks } from './checkers/run-static-checks';
import { completionsRequest } from './schema/completions-request.schema';
import { authRoutes } from './routes/auth.routes';
import { usersRoutes } from './routes/users.routes';

const app = new Hono();

app.post('/v1/chat/completions', async (c) => {
    const schema = await completionsRequest.safeParseAsync(await c.req.json());
    if (schema.error) {
        console.log(schema.error)
        return c.text('Invalid data', 400);
    }

    const json = schema.data;

    // TODO: scan tool calls and other stuff maybe
    for (const message of json.messages) {
        // TODO: should we skip assistant mgs?
        if (message.role !== 'user') continue;

        if (typeof message.content !== 'string') {
            return c.text('Unsupported content', 400);
        }

        const results = runStaticChecks(message.content);

        console.log(results);

        if (results.length === 0) {
            return c.text('All clear!');
        } else {
            return c.text('BAD');
        }
    }

    return c.text("Hi");
})

app.route('/auth', authRoutes);
app.route('/users', usersRoutes);

app.get('/', (c) => {
    return c.text('OK');
});


const results = runStaticChecks(
    'hello world 123-12-5569'
);

console.log(results);

export default app;