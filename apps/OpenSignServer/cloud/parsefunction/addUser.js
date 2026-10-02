const pointerId = value => value?.id || value?.objectId;

export default async function addUser(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }

  const { phone, name, password, team, timezone, role } = request.params || {};
  const email = request.params?.email?.trim().toLowerCase();
  if (!name || !email || !password || !team || !['OrgAdmin', 'Editor', 'User'].includes(role)) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide valid required fields.');
  }

  const actorQuery = new Parse.Query('contracts_Users');
  actorQuery.equalTo('UserId', request.user);
  const actor = await actorQuery.first({ useMasterKey: true });
  const actorRole = actor?.get('UserRole');
  if (!actor || actor.get('IsDisabled') === true ||
      !['contracts_Admin', 'contracts_OrgAdmin'].includes(actorRole) ||
      (role === 'OrgAdmin' && actorRole !== 'contracts_Admin')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not allowed to create this user.');
  }

  const tenantId = pointerId(actor.get('TenantId'));
  const organizationId = pointerId(actor.get('OrganizationId'));
  if (!tenantId || !organizationId) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Administrator has no organization.');
  }

  const teamQuery = new Parse.Query('contracts_Teams');
  const selectedTeam = await teamQuery.get(team, { useMasterKey: true });
  if (pointerId(selectedTeam?.get('OrganizationId')) !== organizationId) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Team does not belong to this organization.');
  }

  const existingQuery = new Parse.Query(Parse.User);
  existingQuery.equalTo('username', email);
  if (await existingQuery.first({ useMasterKey: true })) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User already exists.');
  }
  const existingEmailQuery = new Parse.Query(Parse.User);
  existingEmailQuery.equalTo('email', email);
  if (await existingEmailQuery.first({ useMasterKey: true })) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User already exists.');
  }

  const user = new Parse.User();
  user.set('name', name);
  user.set('username', email);
  user.set('email', email);
  user.set('password', password);
  if (phone) user.set('phone', phone);
  await user.save(null, { useMasterKey: true });

  const extUser = new Parse.Object('contracts_Users');
  extUser.set('Name', name);
  extUser.set('Email', email);
  extUser.set('UserRole', `contracts_${role}`);
  extUser.set('UserId', user);
  extUser.set('CreatedBy', request.user);
  extUser.set('TenantId', { __type: 'Pointer', className: 'partners_Tenant', objectId: tenantId });
  extUser.set('OrganizationId', { __type: 'Pointer', className: 'contracts_Organizations', objectId: organizationId });
  extUser.set('TeamIds', [{ __type: 'Pointer', className: 'contracts_Teams', objectId: team }]);
  if (phone) extUser.set('Phone', phone);
  if (timezone) extUser.set('Timezone', timezone);
  if (actor.get('Company')) extUser.set('Company', actor.get('Company'));

  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  acl.setPublicWriteAccess(true);
  extUser.setACL(acl);
  const saved = await extUser.save(null, { useMasterKey: true });
  return JSON.parse(JSON.stringify(saved));
}
