import { sign, verify } from 'jsonwebtoken';
import { env } from '../env/env';
import { jwtSchema } from '../schema/jwt.schema';

export function createJWT(userId: number) {
    const expiresAt = new Date(Date.now() + env.JWT_TTL_SECONDS * 1000);
    const token = sign({
        userId,
    }, env.JWT_SECRET, {
        expiresIn: env.JWT_TTL_SECONDS,
        algorithm: 'HS256'
    });

    return { token, expiresAt };
}

export function verifyJWT(jwt: string): number {
    const data = verify(jwt, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof data === 'string') throw new Error('Invalid JWT type');

    const { userId } = jwtSchema.parse(data);

    return userId;
}