const SELF_EDITABLE = new Set([
  'Name', 'Phone', 'JobTitle', 'Company', 'Language', 'Timezone', 'TourStatus',
]);

const pointerId = value => value?.id || value?.objectId;

export default async function UsersBeforeSave(request) {
  if (request.master) return;
  if (!request.original) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User profiles can only be created by the server.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const changed = request.object.dirtyKeys();
  if (changed.length === 0) return;

  if (changed.length === 1 && changed[0] === 'IsDisabled') {
    const query = new Parse.Query('contracts_Users');
    query.equalTo('UserId', request.user);
    const actor = await query.first({ useMasterKey: true });
    const actorRole = actor?.get('UserRole');
    const targetRole = request.original.get('UserRole');
    const actorTenant = pointerId(actor?.get('TenantId'));
    const actorOrg = pointerId(actor?.get('OrganizationId'));
    const sameTenant = actorTenant && actorTenant === pointerId(request.original.get('TenantId'));
    const sameOrg = actorOrg && actorOrg === pointerId(request.original.get('OrganizationId'));
    const permittedRole = actorRole === 'contracts_Admin' ||
      (actorRole === 'contracts_OrgAdmin' && targetRole !== 'contracts_OrgAdmin');
    if (actor && actor.get('IsDisabled') !== true && permittedRole && sameTenant && sameOrg &&
      targetRole !== 'contracts_Admin' && pointerId(request.original.get('UserId')) !== request.user.id) {
      return;
    }
  }

  if (pointerId(request.original.get('UserId')) !== request.user.id ||
      changed.some(key => !SELF_EDITABLE.has(key))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'User profile change is not allowed.');
  }
}
