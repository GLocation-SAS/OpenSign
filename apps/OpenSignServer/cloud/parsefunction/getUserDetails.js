async function getUserDetails(request) {
  const reqEmail = request.params.email;
  if (request.user) {
    try {
      const userId = request.params.userId;
      const userQuery = new Parse.Query('contracts_Users');
      if (reqEmail) {
        const actorQuery = new Parse.Query('contracts_Users');
        actorQuery.equalTo('UserId', request.user);
        const actor = await actorQuery.first({ useMasterKey: true });
        if (!actor || actor.get('IsDisabled') === true ||
            !['contracts_Admin', 'contracts_OrgAdmin'].includes(actor.get('UserRole'))) {
          throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not allowed to search users.');
        }
        userQuery.equalTo('OrganizationId', actor.get('OrganizationId'));
        userQuery.equalTo('Email', reqEmail);
      } else {
        const email = request.user.get('email');
        userQuery.equalTo('Email', email);
      }
      userQuery.include('TenantId');
      userQuery.include('UserId');
      userQuery.include('CreatedBy');
      userQuery.exclude('CreatedBy.authData');
      userQuery.exclude('TenantId.FileAdapters');
      userQuery.exclude('google_refresh_token');
      userQuery.exclude('GoogleSubject');
      userQuery.exclude('TenantId.PfxFile');
      if (userId) {
        userQuery.equalTo('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
      }
      const res = await userQuery.first({ useMasterKey: true });
      if (res) {
        if (reqEmail) {
          return { objectId: res.id };
        } else {
          return res;
        }
      } else {
        return '';
      }
    } catch (err) {
      console.log('Err ', err);
      const code = err?.code || 400;
      const msg = err?.message || 'Something went wrong.';
      throw new Parse.Error(code, msg);
    }
  } else {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
}
export default getUserDetails;
