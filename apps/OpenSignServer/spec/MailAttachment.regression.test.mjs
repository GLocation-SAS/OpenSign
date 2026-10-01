import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../cloud/parsefunction/sendMailWithAttachment.js', import.meta.url), 'utf8');

async function loadModule(response) {
  const calls = [];
  const sent = [];
  const context = vm.createContext({
    Buffer, URL, Date,
    process: { env: { SERVER_URL: 'https://firmas.glocation.co/api/app', MASTER_KEY: 'test-only' } },
    console: { log() {} },
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async specifier => {
    const exports = specifier === 'jsonwebtoken' ? ['default']
      : specifier === 'axios' ? ['default']
      : specifier.includes('Utils.js') ? ['appName', 'smtpenable', 'smtpsecure', 'updateMailCount']
      : specifier === 'nodemailer' ? ['createTransport'] : ['default'];
    return new vm.SyntheticModule(exports, function () {
      if (specifier === 'jsonwebtoken') this.setExport('default', { sign: payload => {
        calls.push({ sign: payload });
        return 'signed-token';
      } });
      else if (specifier === 'axios') this.setExport('default', { get: async (url, options) => {
        calls.push({ url, options });
        if (response instanceof Error) throw response;
        return response;
      } });
      else if (specifier.includes('Utils.js')) {
        this.setExport('appName', 'Glocation');
        this.setExport('smtpenable', true);
        this.setExport('smtpsecure', true);
        this.setExport('updateMailCount', async () => {});
      } else if (specifier === 'nodemailer') this.setExport('createTransport', () => ({ sendMail: async message => { sent.push(message); return { response: '250 ok' }; } }));
      else if (specifier === 'node:fs') this.setExport('default', { existsSync: () => false });
      else this.setExport('default', () => ({}));
    }, { context });
  });
  await module.evaluate();
  return { module, calls, sent };
}

test('loads a locally stored signed PDF through the internal route with the public URL in its token', async () => {
  const pdf = Buffer.from('%PDF-1.7\nvalid document');
  const { module, calls } = await loadModule({ status: 200, data: pdf });
  const result = await module.namespace.loadPdfAttachment('http://localhost:3001/api/app/files/opensign/test.pdf?token=old');
  assert.equal(Buffer.compare(result, pdf), 0);
  assert.equal(calls[0].sign.fileUrl, 'https://firmas.glocation.co/api/app/files/opensign/test.pdf');
  assert.equal(calls[1].url, 'http://localhost:8080/app/files/opensign/test.pdf?token=signed-token');
});

test('rejects a successful HTTP response that is not a PDF', async () => {
  const { module } = await loadModule({ status: 200, data: Buffer.from('{"message":"unauthorized"}') });
  await assert.rejects(module.namespace.loadPdfAttachment('http://localhost:3001/api/app/files/opensign/test.pdf'));
});

test('rejects a failed download', async () => {
  const { module } = await loadModule(new Error('download failed'));
  await assert.rejects(module.namespace.loadPdfAttachment('http://localhost:3001/api/app/files/opensign/test.pdf'));
});

test('only sends an email when its attachment contains a PDF', async () => {
  const pdf = Buffer.from('%PDF-1.7\nvalid document');
  const valid = await loadModule({ status: 200, data: pdf });
  const params = { url: 'http://localhost:3001/api/app/files/opensign/test.pdf', recipient: 'recipient@example.test', subject: 'Test' };
  assert.equal((await valid.module.namespace.default(params)).status, 'success');
  assert.equal(valid.sent.length, 1);
  assert.equal(Buffer.compare(valid.sent[0].attachments[0].content, pdf), 0);

  const invalid = await loadModule({ status: 200, data: Buffer.from('error page') });
  assert.equal((await invalid.module.namespace.default(params)).status, 'error');
  assert.equal(invalid.sent.length, 0);
});
