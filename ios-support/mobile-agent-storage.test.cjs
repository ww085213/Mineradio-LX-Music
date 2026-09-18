'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentApi } = require('../agent-api');
test('mobile Agent uses async secure-storage adapter and never persists plaintext API keys', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-agent-storage-test-'));
  const configFile = path.join(directory, 'agent.json');
  const key = crypto.randomBytes(32);
  let encryptions = 0, decryptions = 0;
  const previousMobile = process.env.MINERADIO_MOBILE;
  const previousEnvKey = process.env.MINERADIO_AGENT_API_KEY;
  const previousStorage = globalThis.mineradioSecureStorage;
  process.env.MINERADIO_MOBILE = '1'; delete process.env.MINERADIO_AGENT_API_KEY;
  globalThis.mineradioSecureStorage = {
    isEncryptionAvailable: () => true, isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(text) {
      encryptions++;
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);
    },
    async decryptStringAsync(data) {
      decryptions++;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(-16));
      return { result: Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString() };
    }
  };
  try {
    const options = { configFile, fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer test-only-not-a-real-key');
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }) };
    } };
    const api = createAgentApi(options);
    const settings = { enabled: true, provider: 'openai', model: 'test-model', apiKey: 'test-only-not-a-real-key' };
    const saved = await api.saveConfig(settings);
    assert.equal(saved.hasApiKey, true); assert.equal(saved.secureStorageAvailable, true);
    assert.equal(fs.readFileSync(configFile, 'utf8').includes(settings.apiKey), false);
    const reloaded = createAgentApi(options);
    assert.equal((await reloaded.testConnection()).ok, true);
    await reloaded.saveConfig({ ...settings, enabled: false, apiKey: '' });
    assert.equal(encryptions, 1); assert.equal(decryptions, 1);
    await reloaded.saveConfig({ ...settings, apiKey: '', clearApiKey: true });
    assert.equal(reloaded.getConfig().hasApiKey, false);
  } finally {
    if (previousMobile === undefined) delete process.env.MINERADIO_MOBILE; else process.env.MINERADIO_MOBILE = previousMobile;
    if (previousEnvKey === undefined) delete process.env.MINERADIO_AGENT_API_KEY; else process.env.MINERADIO_AGENT_API_KEY = previousEnvKey;
    globalThis.mineradioSecureStorage = previousStorage;
  }
});
