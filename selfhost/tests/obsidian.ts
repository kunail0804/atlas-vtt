// What the plugin's GM code takes from Obsidian, for the relay's tests: `requestUrl`, which here is
// `fetch`. Nothing else of Obsidian is here, so a test that needs more fails where it reaches for it.

interface RequestUrlParam {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | ArrayBuffer;
  readonly contentType?: string;
}

export async function requestUrl(request: RequestUrlParam): Promise<{ status: number; text: string; readonly json: unknown }> {
  const response = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: { ...request.headers, ...(request.contentType === undefined ? {} : { 'content-type': request.contentType }) },
    ...(request.body === undefined ? {} : { body: request.body }),
  });
  const text = await response.text();
  return { status: response.status, text, get json(): unknown { return JSON.parse(text); } };
}
