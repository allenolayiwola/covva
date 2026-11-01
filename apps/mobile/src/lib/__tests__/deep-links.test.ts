import { LINK_DOMAINS, mapIncomingLink } from '../deep-links';
import { redirectSystemPath } from '../../../app/+native-intent';

describe('mapIncomingLink', () => {
  it.each(LINK_DOMAINS)('maps web routes on %s to app routes', (host) => {
    expect(mapIncomingLink(`https://${host}/account`)).toBe('/');
    expect(mapIncomingLink(`https://${host}/account/`)).toBe('/');
    expect(mapIncomingLink(`https://${host}/account/policies`)).toBe('/policies');
    expect(mapIncomingLink(`https://${host}/account/policies/pol_123`)).toBe('/policies/pol_123');
    expect(mapIncomingLink(`https://${host}/account/policies/pol_123/renew?x=1`)).toBe('/policies/pol_123');
    expect(mapIncomingLink(`https://${host}/account/policies/new`)).toBe('/policies');
    expect(mapIncomingLink(`https://${host}/account/requests/req_9/quotes`)).toBe('/requests');
    expect(mapIncomingLink(`https://${host}/account/profile`)).toBe('/account');
    expect(mapIncomingLink(`https://${host}/account/claims/c1`)).toBe('/');
    expect(mapIncomingLink(`https://${host}/auth/callback?code=abc`)).toBe('/');
  });

  it('encodes policy ids', () => {
    expect(mapIncomingLink('https://app.covva.com.gh/account/policies/a%20b')).toBe('/policies/a%20b');
  });

  it('leaves app paths, custom-scheme links and other hosts alone', () => {
    expect(mapIncomingLink('/policies/1')).toBe('/policies/1');
    expect(mapIncomingLink('covva://policies/1')).toBe('covva://policies/1');
    expect(mapIncomingLink('https://example.com/account/policies/1')).toBe('https://example.com/account/policies/1');
    expect(mapIncomingLink('http://app.covva.com.gh/account')).toBe('http://app.covva.com.gh/account');
  });

  it('is wired into the router native intent', () => {
    expect(redirectSystemPath({ path: 'https://app.covva.com.gh/account/policies/p1', initial: true })).toBe('/policies/p1');
    expect(redirectSystemPath({ path: '/requests', initial: false })).toBe('/requests');
  });
});
