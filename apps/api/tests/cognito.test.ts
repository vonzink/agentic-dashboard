import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { CognitoVerifier } from '../src/middleware/cognito';
import { MemoryStore } from '../src/repositories/memory';
import { seedDefaults } from '../src/services/seed';

/**
 * Cognito JWT verification, tested against a locally generated RSA key
 * pair standing in for the user pool's JWKS. No AWS account involved.
 */
const POOL = { region: 'us-east-1', userPoolId: 'us-east-1_TESTPOOL', clientId: 'test-client-id' };
const ISSUER = `https://cognito-idp.${POOL.region}.amazonaws.com/${POOL.userPoolId}`;

let privateKey: CryptoKey;
let localJwks: JWTVerifyGetKey;
let verifier: CognitoVerifier;
let rogueKey: CryptoKey;

async function token(claims: Record<string, unknown>, key: CryptoKey = privateKey, expiresIn = '1h') {
  return new SignJWT({
    token_use: 'access',
    client_id: POOL.clientId,
    username: 'test-user@msfg.test',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer((claims.iss as string) ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  const jwk = await exportJWK(pair.publicKey);
  const jwks: JSONWebKeySet = { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] };
  localJwks = createLocalJWKSet(jwks);
  verifier = new CognitoVerifier(POOL, localJwks);
  rogueKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
});

describe('CognitoVerifier', () => {
  it('accepts a valid access token and maps groups to the highest role', async () => {
    const user = await verifier.verify(
      await token({ 'cognito:groups': ['reviewer', 'operator'] }),
    );
    expect(user).toEqual({ email: 'test-user@msfg.test', role: 'reviewer' });
  });

  it('accepts a valid id token (aud check instead of client_id)', async () => {
    const user = await verifier.verify(
      await token({
        token_use: 'id',
        client_id: undefined,
        aud: POOL.clientId,
        email: 'ID-Token@MSFG.test',
        'cognito:groups': ['admin'],
      }),
    );
    expect(user).toEqual({ email: 'id-token@msfg.test', role: 'admin' });
  });

  it('defaults to viewer (least privilege) when there are no matching groups', async () => {
    const user = await verifier.verify(await token({ 'cognito:groups': ['some-other-team'] }));
    expect(user.role).toBe('viewer');
    const noGroups = await verifier.verify(await token({}));
    expect(noGroups.role).toBe('viewer');
  });

  it('respects a group prefix (e.g. msfg-admin)', async () => {
    const prefixed = new CognitoVerifier(POOL, localJwks, 'msfg-');
    const admin = await prefixed.verify(
      await token({ 'cognito:groups': ['msfg-admin', 'unrelated'] }),
    );
    expect(admin.role).toBe('admin');
    // Unprefixed role names no longer match when a prefix is configured.
    const plain = await prefixed.verify(await token({ 'cognito:groups': ['admin'] }));
    expect(plain.role).toBe('viewer');
  });

  it('rejects: wrong signature, wrong issuer, expired, wrong client, bad token_use', async () => {
    const cases = [
      token({}, rogueKey), // signed by an unknown key
      token({ iss: 'https://evil.example.com/pool' }),
      token({}, privateKey, '-1h'), // already expired
      token({ client_id: 'other-client' }),
      token({ token_use: 'refresh' }),
    ];
    for (const t of cases) {
      await expect(verifier.verify(await t)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    }
  });
});

describe('AUTH_MODE=cognito end-to-end', () => {
  it('authenticates requests via Bearer token and enforces mapped roles', async () => {
    const store = new MemoryStore();
    await seedDefaults(store);
    const config = loadConfig({
      env: 'local',
      authMode: 'cognito',
      cognito: POOL,
      databaseUrl: null,
      modelProvider: 'mock',
    });
    const { app } = buildApp(store, config, { verifier });

    // No token → 401
    await request(app).get('/api/ai/tasks').expect(401);
    // Dev headers are ignored in cognito mode → still 401
    await request(app).get('/api/ai/tasks').set('x-user-role', 'admin').expect(401);

    const operatorToken = await token({ 'cognito:groups': ['operator'] });
    const created = await request(app)
      .post('/api/ai/tasks')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ title: 'Cognito task', task_type: 'general' });
    expect(created.status).toBe(201);
    expect(created.body.created_by).toBe('test-user@msfg.test');

    // Operators cannot access admin endpoints
    await request(app)
      .post('/api/ai/prompts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({})
      .expect(403);

    // Viewers (no groups) cannot create
    const viewerToken = await token({});
    await request(app)
      .post('/api/ai/tasks')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: 'nope', task_type: 'general' })
      .expect(403);
  });
});
