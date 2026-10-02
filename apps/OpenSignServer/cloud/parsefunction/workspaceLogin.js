import crypto from 'node:crypto';
import axios from 'axios';
import { google } from 'googleapis';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

const pointerId = value => value?.id || value?.objectId;
const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });

export default async function workspaceLogin(request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const tenantId = process.env.WORKSPACE_TENANT_ID;
  const organizationId = process.env.WORKSPACE_ORGANIZATION_ID;
  const teamId = process.env.WORKSPACE_TEAM_ID;
  if (!clientId || !tenantId || !organizationId || !teamId) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Workspace login is not configured.');
  }
  const credential = request.params?.credential;
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 10000) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Invalid Google credential.');
  }

  let claims;
  try {
    const ticket = await new google.auth.OAuth2(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    claims = ticket.getPayload();
  } catch {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Google identity verification failed.');
  }
  const email = claims?.email?.toLowerCase();
  if (!claims?.sub || !email || claims.email_verified !== true ||
      claims.hd !== 'glocation.com.co' || !email.endsWith('@glocation.com.co') ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This account is not eligible for Workspace login.');
  }

  const bySubject = new Parse.Query('contracts_Users');
  bySubject.equalTo('GoogleSubject', claims.sub);
  let profile = await bySubject.first({ useMasterKey: true });
  if (profile && profile.get('Email')?.toLowerCase() !== email) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Google account email changed; contact an administrator.');
  }
  if (!profile) {
    const byEmail = new Parse.Query('contracts_Users');
    byEmail.equalTo('Email', email);
    profile = await byEmail.first({ useMasterKey: true });
    if (profile?.get('GoogleSubject') && profile.get('GoogleSubject') !== claims.sub) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This email is linked to another Google account.');
    }
  }

  if (profile) {
    if (pointerId(profile.get('TenantId')) !== tenantId ||
        pointerId(profile.get('OrganizationId')) !== organizationId ||
        profile.get('IsDisabled') === true) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This account is not active in the configured organization.');
    }
    if (!profile.get('GoogleSubject')) {
      profile.set('GoogleSubject', claims.sub);
      await profile.save(null, { useMasterKey: true });
    }
  } else {
    const existingUser = new Parse.Query(Parse.User);
    existingUser.equalTo('username', email);
    if (await existingUser.first({ useMasterKey: true })) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Existing account requires administrator review.');
    }
    const existingEmail = new Parse.Query(Parse.User);
    existingEmail.equalTo('email', email);
    if (await existingEmail.first({ useMasterKey: true })) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Existing account requires administrator review.');
    }
    const user = new Parse.User();
    user.set('username', email);
    user.set('email', email);
    user.set('name', claims.name || email.split('@')[0]);
    user.set('password', crypto.randomBytes(48).toString('hex'));
    await user.save(null, { useMasterKey: true });

    profile = new Parse.Object('contracts_Users');
    profile.set('UserId', user);
    profile.set('UserRole', 'contracts_User');
    profile.set('Name', claims.name || email.split('@')[0]);
    profile.set('Email', email);
    profile.set('GoogleSubject', claims.sub);
    profile.set('TenantId', pointer('partners_Tenant', tenantId));
    profile.set('OrganizationId', pointer('contracts_Organizations', organizationId));
    profile.set('TeamIds', [pointer('contracts_Teams', teamId)]);
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(true);
    profile.setACL(acl);
    await profile.save(null, { useMasterKey: true });
  }

  const userId = pointerId(profile.get('UserId'));
  const response = await axios.post(`${cloudServerUrl}/loginAs`, null, {
    headers: {
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Master-Key': process.env.MASTER_KEY,
    },
    params: { userId },
  });
  return { sessionToken: response.data.sessionToken };
}
