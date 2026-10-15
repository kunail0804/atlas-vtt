/** What the service asks of Cloudflare's API for a campaign. The tests stand in for it. */
export interface CloudflareApi {
  /** Creates a tunnel whose route Cloudflare keeps: `host` to the relay's public side in the container. */
  createTunnel(name: string, host: string): Promise<string>;
  tunnelToken(tunnelId: string): Promise<string>;
  /** Closes the tunnel's connections, then deletes it: Cloudflare deletes no tunnel that is connected. */
  deleteTunnel(tunnelId: string): Promise<void>;
  /** A proxied CNAME from `host` to the tunnel; returns the record's id. */
  createRecord(host: string, tunnelId: string): Promise<string>;
  deleteRecord(recordId: string): Promise<void>;
}

const API = 'https://api.cloudflare.com/client/v4';

interface Answer<T> {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly { readonly code: number; readonly message: string }[];
}

export class CloudflareError extends Error {}

/** Cloudflare's API with the account and zone of `kunlab.cc`. The token needs Tunnel: Edit and DNS: Edit. */
export function cloudflareApi(token: string, accountId: string, zoneId: string, fetcher: typeof fetch = fetch): CloudflareApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetcher(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const answer = (await response.json()) as Answer<T>;
    if (!response.ok || !answer.success) {
      const reason = answer.errors?.map((error) => `${error.code} ${error.message}`).join('; ') ?? response.statusText;
      throw new CloudflareError(`${method} ${path}: ${reason}`);
    }
    return answer.result;
  }
  const tunnels = `/accounts/${accountId}/cfd_tunnel`;
  return {
    async createTunnel(name, host) {
      const tunnel = await call<{ id: string }>('POST', tunnels, { name, config_src: 'cloudflare' });
      await call('PUT', `${tunnels}/${tunnel.id}/configurations`, {
        config: { ingress: [{ hostname: host, service: 'http://localhost:8788' }, { service: 'http_status:404' }] },
      });
      return tunnel.id;
    },
    tunnelToken: (tunnelId) => call<string>('GET', `${tunnels}/${tunnelId}/token`),
    async deleteTunnel(tunnelId) {
      await call('DELETE', `${tunnels}/${tunnelId}/connections`);
      await call('DELETE', `${tunnels}/${tunnelId}`);
    },
    async createRecord(host, tunnelId) {
      const record = await call<{ id: string }>('POST', `/zones/${zoneId}/dns_records`, {
        type: 'CNAME', name: host, content: `${tunnelId}.cfargotunnel.com`, proxied: true, comment: 'Atlas VTT campaign',
      });
      return record.id;
    },
    async deleteRecord(recordId) {
      await call('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
    },
  };
}
