import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../cloud/parsefunction/workspaceLogin.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default ', '') + '\nworkspaceLogin';

class ParseError extends Error {
  static INVALID_QUERY = 102;
  static OPERATION_FORBIDDEN = 119;
  static INTERNAL_SERVER_ERROR = 1;
  constructor(code, message) { super(message); this.code = code; }
}

function fixture(claims, existing = [], users = []) {
  const records = { _User: [...users], contracts_Users: [...existing] };
  class Entity {
    constructor(className) { this.className = className; this.fields = {}; }
    get(key) { return this.fields[key]; }
    set(key, value) { this.fields[key] = value; }
    setACL() {}
    async save() {
      if (!this.id) { this.id = `new-${records[this.className].length + 1}`; records[this.className].push(this); }
      return this;
    }
  }
  class User extends Entity { constructor() { super('_User'); } }
  class Query {
    constructor(className) { this.className = className === User ? '_User' : className; }
    equalTo(key, value) { this.key = key; this.value = value; return this; }
    async first() {
      return records[this.className].find(item => {
        const value = item.get(this.key);
        return this.key === 'UserId'
          ? (value?.id || value?.objectId) === (this.value?.id || this.value?.objectId)
          : value === this.value;
      });
    }
  }
  const verified = [];
  const google = { auth: { OAuth2: class {
    verifyIdToken({ idToken, audience }) { verified.push({ idToken, audience }); return { getPayload: () => claims }; }
  } } };
  const axios = { post: async () => ({ data: { sessionToken: 'session-1' } }) };
  const env = {
    GOOGLE_CLIENT_ID: 'client-1', WORKSPACE_TENANT_ID: 'tenant-1',
    WORKSPACE_ORGANIZATION_ID: 'org-1', WORKSPACE_TEAM_ID: 'team-1', MASTER_KEY: 'master',
  };
  const login = vm.runInNewContext(source, {
    Parse: { Error: ParseError, Query, User, Object: Entity, ACL: class {
      setPublicReadAccess() {} setPublicWriteAccess() {}
    } },
    google, axios, crypto: { randomBytes: () => Buffer.alloc(48) },
    cloudServerUrl: 'https://example.test/api/app', serverAppId: 'app', process: { env },
  });
  return { login, records, verified };
}

const employee = {
  sub: 'subject-1', email: 'employee@glocation.com.co', email_verified: true,
  hd: 'glocation.com.co', iss: 'https://accounts.google.com', name: 'Employee',
};

test('rejects a personal Google account even when the email looks corporate', async () => {
  const { login, records } = fixture({ ...employee, hd: undefined });
  await assert.rejects(login({ params: { credential: 'x'.repeat(200) } }), { code: 119 });
  assert.equal(records.contracts_Users.length, 0);
});

test('creates first-time Workspace employee with the basic role in the configured organization', async () => {
  const { login, records, verified } = fixture(employee);
  const result = await login({ params: { credential: 'x'.repeat(200) } });
  assert.equal(result.sessionToken, 'session-1');
  assert.equal(verified[0].audience, 'client-1');
  assert.equal(records.contracts_Users[0].get('UserRole'), 'contracts_User');
  assert.equal(records.contracts_Users[0].get('TenantId').objectId, 'tenant-1');
  assert.equal(records.contracts_Users[0].get('OrganizationId').objectId, 'org-1');
  assert.equal(records.contracts_Users[0].get('GoogleSubject'), 'subject-1');
});

test('links an existing administrator without changing their role', async () => {
  const profile = {
    id: 'profile-1',
    fields: {
      Email: employee.email, UserRole: 'contracts_Admin',
      TenantId: { objectId: 'tenant-1' }, OrganizationId: { objectId: 'org-1' },
      UserId: { objectId: 'user-1' },
    },
    get(key) { return this.fields[key]; },
    set(key, value) { this.fields[key] = value; },
    async save() { return this; },
  };
  const { login, records } = fixture(employee, [profile]);
  await login({ params: { credential: 'x'.repeat(200) } });
  assert.equal(profile.get('UserRole'), 'contracts_Admin');
  assert.equal(profile.get('GoogleSubject'), employee.sub);
  assert.equal(records._User.length, 0);
});

test('rejects a Google subject that conflicts with an existing account link', async () => {
  const profile = {
    fields: { Email: employee.email, GoogleSubject: 'different-subject' },
    get(key) { return this.fields[key]; },
  };
  const { login } = fixture(employee, [profile]);
  await assert.rejects(login({ params: { credential: 'x'.repeat(200) } }), { code: 119 });
});

test('reuses an existing internal user without a profile and preserves its password', async () => {
  const user = {
    id: 'user-1',
    fields: { username: employee.email, email: employee.email, password: 'existing-password' },
    get(key) { return this.fields[key]; },
  };
  const { login, records } = fixture(employee, [], [user]);
  const result = await login({ params: { credential: 'x'.repeat(200) } });
  assert.equal(result.sessionToken, 'session-1');
  assert.equal(records._User.length, 1);
  assert.equal(records.contracts_Users[0].get('UserId'), user);
  assert.equal(records.contracts_Users[0].get('UserRole'), 'contracts_User');
  assert.equal(user.get('password'), 'existing-password');
});

test('does not link an internal user whose stored email differs from Google', async () => {
  const user = {
    id: 'user-1',
    get(key) { return { username: employee.email, email: 'other@glocation.com.co' }[key]; },
  };
  const { login, records } = fixture(employee, [], [user]);
  await assert.rejects(login({ params: { credential: 'x'.repeat(200) } }), { code: 119 });
  assert.equal(records.contracts_Users.length, 0);
});

test('does not link when username and email belong to different internal users', async () => {
  const usernameUser = {
    id: 'user-1',
    get(key) { return { username: employee.email, email: 'other@glocation.com.co' }[key]; },
  };
  const emailUser = {
    id: 'user-2',
    get(key) { return { username: 'other@glocation.com.co', email: employee.email }[key]; },
  };
  const { login, records } = fixture(employee, [], [usernameUser, emailUser]);
  await assert.rejects(login({ params: { credential: 'x'.repeat(200) } }), { code: 119 });
  assert.equal(records.contracts_Users.length, 0);
});

test('does not create a second profile for an internal user already linked elsewhere', async () => {
  const user = {
    id: 'user-1',
    get(key) { return { username: employee.email, email: employee.email }[key]; },
  };
  const profile = {
    get(key) { return { Email: 'old@glocation.com.co', UserId: { objectId: user.id } }[key]; },
  };
  const { login, records } = fixture(employee, [profile], [user]);
  await assert.rejects(login({ params: { credential: 'x'.repeat(200) } }), { code: 119 });
  assert.equal(records.contracts_Users.length, 1);
});
