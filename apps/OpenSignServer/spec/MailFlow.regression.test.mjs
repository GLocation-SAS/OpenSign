import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const forwardDocSource = readFileSync(
  new URL('../cloud/parsefunction/ForwardDoc.js', import.meta.url),
  'utf8'
);
const pdfSource = readFileSync(
  new URL('../cloud/parsefunction/pdf/PDF.js', import.meta.url),
  'utf8'
);

test('forwarding a signed document calls the mail service with the configured logo URL', async () => {
  const sent = [];
  class ParseError extends Error {
    static INVALID_SESSION_TOKEN = 209;
    static OBJECT_NOT_FOUND = 101;
    static INVALID_QUERY = 102;
  }
  class Query {
    equalTo() { return this; }
    notEqualTo() { return this; }
    include() { return this; }
    async first() {
      return {
        toJSON: () => ({
          Name: 'Test document',
          SignedUrl: 'https://firmas.glocation.co/files/test.pdf',
          ExtUserPtr: { objectId: 'owner-1', Email: 'owner@example.test', Name: 'Owner' },
        }),
      };
    }
  }
  const context = vm.createContext({
    Parse: { Error: ParseError, Query },
    process: { env: { PUBLIC_URL: 'https://firmas.glocation.co' } },
    console: { log() {} },
  });
  const module = new vm.SourceTextModule(forwardDocSource, { context });
  await module.link(async specifier => {
    if (specifier.endsWith('Utils.js')) {
      return new vm.SyntheticModule(['appName'], function () {
        this.setExport('appName', 'Glocation');
      }, { context });
    }
    return new vm.SyntheticModule(['default'], function () {
      this.setExport('default', async params => {
        sent.push(params);
        return { status: 'success' };
      });
    }, { context });
  });
  await module.evaluate();

  const result = await module.namespace.default({
    user: { id: 'user-1' },
    params: { docId: 'doc-1', recipients: ['recipient@example.test'] },
    headers: {},
  });
  assert.equal(result.status, 'success');
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /https:\/\/firmas\.glocation\.co\/logo\.png/);
});

test('signer notification uses its public URL and reaches the mail function', async () => {
  const start = pdfSource.indexOf('async function sendNotifyMail(');
  const end = pdfSource.indexOf('// `sendCompletedMail`', start);
  assert.ok(start >= 0 && end > start);
  const sent = [];
  const errors = [];
  const sendNotifyMail = vm.runInNewContext(
    `${pdfSource.slice(start, end)}\nsendNotifyMail`,
    {
      appName: 'Glocation',
      serverUrl: 'https://server.example.test',
      headers: {},
      axios: { post: async (url, body) => sent.push({ url, body }) },
      console: { log: (...args) => errors.push(args) },
    }
  );
  await sendNotifyMail(
    {
      objectId: 'doc-1',
      Name: 'Test document',
      AuditTrail: [],
      Placeholders: [{ Role: 'signer' }, { Role: 'signer' }],
      NotifyOnSignatures: true,
      ExtUserPtr: { objectId: 'owner-1', Name: 'Owner', Email: 'owner@example.test' },
    },
    { Name: 'Signer', Email: 'signer@example.test' },
    '',
    'https://firmas.glocation.co'
  );
  assert.equal(errors.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.html, /https:\/\/firmas\.glocation\.co\/logo\.png/);
});
