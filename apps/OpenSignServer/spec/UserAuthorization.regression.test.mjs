import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const beforeSaveSource = readFileSync(new URL('../cloud/parsefunction/UsersBeforeSave.js', import.meta.url), 'utf8');
const addUserSource = readFileSync(new URL('../cloud/parsefunction/addUser.js', import.meta.url), 'utf8');
const addAdminSource = readFileSync(new URL('../cloud/parsefunction/AddAdmin.js', import.meta.url), 'utf8');
const signUpSource = readFileSync(new URL('../cloud/parsefunction/usersignup.js', import.meta.url), 'utf8');
const listUsersSource = readFileSync(new URL('../cloud/parsefunction/getUserListByOrg.js', import.meta.url), 'utf8');

class ParseError extends Error {
  static INVALID_SESSION_TOKEN = 209;
  static OPERATION_FORBIDDEN = 119;
  static INVALID_QUERY = 102;
  constructor(code, message) { super(message); this.code = code; }
}

function parseObject(fields) {
  return {
    id: fields.id,
    get: key => fields[key],
    dirtyKeys: () => fields.dirtyKeys || [],
  };
}

function loadBeforeSave(caller) {
  class Query {
    equalTo() { return this; }
    async first() { return caller; }
  }
  return vm.runInNewContext(beforeSaveSource.replace('export default ', '') + '\nUsersBeforeSave', {
    Parse: { Error: ParseError, Query },
  });
}

test('direct role and tenant changes are rejected even for a signed-in user', async () => {
  const beforeSave = loadBeforeSave(null);
  const original = parseObject({ id: 'profile-1', UserRole: 'contracts_User', UserId: { id: 'user-1' } });
  const changed = parseObject({ id: 'profile-1', UserRole: 'contracts_Admin', UserId: { id: 'user-1' }, dirtyKeys: ['UserRole'] });
  await assert.rejects(beforeSave({ user: { id: 'user-1' }, original, object: changed }), { code: 119 });
});

test('direct creation of a profile is rejected without master access', async () => {
  const beforeSave = loadBeforeSave(null);
  await assert.rejects(beforeSave({ user: { id: 'user-1' }, object: parseObject({ dirtyKeys: ['UserRole'] }) }), { code: 119 });
});

test('a user may update their own ordinary profile fields', async () => {
  const beforeSave = loadBeforeSave(null);
  const original = parseObject({ id: 'profile-1', UserId: { id: 'user-1' } });
  const changed = parseObject({ id: 'profile-1', UserId: { id: 'user-1' }, Name: 'New name', dirtyKeys: ['Name'] });
  await beforeSave({ user: { id: 'user-1' }, original, object: changed });
});

test('an anonymous request cannot update tour state or another profile', async () => {
  const beforeSave = loadBeforeSave(null);
  const original = parseObject({ id: 'profile-1', UserId: { id: 'user-1' } });
  const changed = parseObject({ id: 'profile-1', UserId: { id: 'user-1' }, dirtyKeys: ['TourStatus'] });
  await assert.rejects(beforeSave({ original, object: changed }), { code: 209 });
});

test('a tenant administrator may disable a regular user but not an administrator', async () => {
  const actor = parseObject({
    UserRole: 'contracts_Admin', TenantId: { id: 'tenant-1' },
    OrganizationId: { id: 'org-1' },
  });
  const beforeSave = loadBeforeSave(actor);
  const regularUser = parseObject({
    id: 'profile-2', UserRole: 'contracts_User', UserId: { id: 'user-2' },
    TenantId: { id: 'tenant-1' }, OrganizationId: { id: 'org-1' },
  });
  const changed = parseObject({ id: 'profile-2', dirtyKeys: ['IsDisabled'] });
  await beforeSave({ user: { id: 'admin-1' }, original: regularUser, object: changed });

  const otherAdmin = parseObject({
    id: 'profile-3', UserRole: 'contracts_Admin', UserId: { id: 'admin-2' },
    TenantId: { id: 'tenant-1' }, OrganizationId: { id: 'org-1' },
  });
  await assert.rejects(beforeSave({ user: { id: 'admin-1' }, original: otherAdmin, object: changed }), { code: 119 });
});

test('a tenant administrator cannot change status in another organization', async () => {
  const actor = parseObject({
    UserRole: 'contracts_Admin', TenantId: { id: 'tenant-1' },
    OrganizationId: { id: 'org-1' },
  });
  const beforeSave = loadBeforeSave(actor);
  const target = parseObject({
    id: 'profile-2', UserRole: 'contracts_User', UserId: { id: 'user-2' },
    TenantId: { id: 'tenant-1' }, OrganizationId: { id: 'org-2' },
  });
  await assert.rejects(beforeSave({
    user: { id: 'admin-1' }, original: target,
    object: parseObject({ id: 'profile-2', dirtyKeys: ['IsDisabled'] }),
  }), { code: 119 });
});

test('a regular user cannot create an administrator through adduser', async () => {
  const source = addUserSource.replace('export default ', '') + '\naddUser';
  const addUser = vm.runInNewContext(source, {
    Parse: { Error: ParseError, Query: class { equalTo() { return this; } async first() { return parseObject({ UserRole: 'contracts_User' }); } }, Object: class { constructor() { throw new Error('Must not create user'); } } },
    console: { log() {} },
  });
  await assert.rejects(addUser({
    user: { id: 'user-1' },
    params: { name: 'New user', email: 'new@example.test', password: 'test-password', role: 'OrgAdmin', tenantId: 'tenant-1', team: 'team-1', organization: { objectId: 'org-1' } },
  }), { code: 119 });
});

test('administrator bootstrap is blocked after an administrator exists', async () => {
  const source = addAdminSource.replace(/^import .*;\n/gm, '').replace('export default ', '') + '\nAddAdmin';
  const addAdmin = vm.runInNewContext(source, {
    Parse: { Error: ParseError, Query: class {
      equalTo() { return this; }
      async first() { return parseObject({ id: 'admin-1' }); }
    } },
    process: { env: { MASTER_KEY: 'master' } }, cloudServerUrl: 'https://example.test',
    serverAppId: 'app', axios: () => { throw new Error('Must not mint a session'); },
  });
  await assert.rejects(addAdmin({
    user: { get: () => 'admin@glocation.com.co' },
    params: { userDetails: { email: 'admin@glocation.com.co', role: 'contracts_Admin' } },
  }), { code: 119 });
});

test('public signup cannot request an administrator role', async () => {
  const source = signUpSource.replace(/^import .*;\n/gm, '').replace('export default ', '') + '\nusersignup';
  const signUp = vm.runInNewContext(source, {
    Parse: { Error: ParseError }, process: { env: { MASTER_KEY: 'master' } },
    cloudServerUrl: 'https://example.test', serverAppId: 'app',
  });
  await assert.rejects(signUp({
    user: { get: () => 'employee@glocation.com.co' },
    params: { userDetails: { email: 'employee@glocation.com.co', role: 'contracts_Admin' } },
  }), { code: 119 });
});

test('a signed-in user cannot list profiles from another organization', async () => {
  const listUsers = vm.runInNewContext(listUsersSource.replace('export default ', '') + '\ngetUserListByOrg', {
    Parse: { Error: ParseError, Query: class {
      equalTo() { return this; }
      async first() {
        return parseObject({ UserRole: 'contracts_Admin', OrganizationId: { id: 'org-1' } });
      }
    } },
    console: { log() {} },
  });
  await assert.rejects(listUsers({
    user: { id: 'admin-1' }, params: { organizationId: 'org-2' },
  }), { code: 119 });
});
