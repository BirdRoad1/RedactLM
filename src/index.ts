import { Hono } from 'hono';
import { runStaticChecks } from './checkers/run-static-checks';

const app = new Hono();

app.get('/', (c) => {
    return c.text('OK');
});


const results = runStaticChecks(
    'hello world 123-12-5569'
);

console.log(results);

export default app;