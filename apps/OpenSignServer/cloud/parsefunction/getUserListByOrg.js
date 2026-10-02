export default async function getUserListByOrg(req) {
  const OrganizationId = req.params.organizationId;
  const orgPtr = {
    __type: 'Pointer',
    className: 'contracts_Organizations',
    objectId: OrganizationId,
  };
  if (!req?.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  } else {
    try {
      const actorQuery = new Parse.Query('contracts_Users');
      actorQuery.equalTo('UserId', req.user);
      const actor = await actorQuery.first({ useMasterKey: true });
      const actorOrg = actor?.get('OrganizationId');
      const actorOrgId = actorOrg?.id || actorOrg?.objectId;
      if (!actor || actor.get('IsDisabled') === true ||
          !['contracts_Admin', 'contracts_OrgAdmin'].includes(actor.get('UserRole')) ||
          !actorOrgId || actorOrgId !== OrganizationId) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not allowed to list this organization.');
      }
      const extUser = new Parse.Query('contracts_Users');
      extUser.equalTo('OrganizationId', orgPtr);
      extUser.include('TeamIds');
      extUser.exclude('GoogleSubject');
      extUser.descending('createdAt');
      const userRes = await extUser.find({ useMasterKey: true });
      if (userRes.length > 0) {
        const _userRes = JSON.parse(JSON.stringify(userRes));
        return _userRes;
      } else {
        return [];
      }
    } catch (err) {
      console.log('err in getuserlist', err);
      throw err;
    }
  }
}
