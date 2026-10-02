export default async function updateTourStatus(request) {
  const tourstatus = request.params.TourStatus;
  const extUserId = request.params.ExtUserId;

  if (request.user) {
    try {
      const query = new Parse.Query('contracts_Users');
      const updateUser = await query.get(extUserId, { useMasterKey: true });
      const owner = updateUser.get('UserId');
      if ((owner?.id || owner?.objectId) !== request.user.id) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Not allowed to update this profile.');
      }
      updateUser.set('TourStatus', tourstatus);
      const res = await updateUser.save(null, { useMasterKey: true });
      return res;
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
