import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('retired public screen URLs return Gone without redirecting', async () => {
  for (const path of ['/display', '/display/', '/display/index.html']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await worker.fetch(new Request(`https://shul.example${path}?theme=light&screen=2`, {method}), {});
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if(method === 'HEAD') assert.equal(await response.text(), '');
    }
    const response = await worker.fetch(new Request(`https://shul.example${path}`, {method:'POST'}), {});
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('location'), null);
  }
});

test('slashless and index TV URLs still redirect to the canonical screen with query intact', async () => {
  for (const path of ['/tv', '/tv/index.html']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await worker.fetch(new Request(`https://shul.example${path}?theme=light&screen=2`, {method}), {});
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), 'https://shul.example/tv/?theme=light&screen=2');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const response = await worker.fetch(new Request(`https://shul.example${path}`, {method:'POST'}), {});
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('location'), null);
  }
});

test('TV shell, canonical worker and legacy retirement worker remain public without redirecting assets', async () => {
  for (const [path, scope] of [
    ['/tv/', null], ['/tv/sw.js', '/tv/'], ['/display/sw.js', '/display/'],
    ['/display-assets/display.js', null], ['/display-assets/display.css', null],
  ]) {
    let assetPath;
    const env = {ASSETS:{fetch:async request => {
      assetPath = new URL(request.url).pathname;
      return new Response('asset', {headers:{'Content-Type':path.endsWith('.js')?'application/javascript':'text/html'}});
    }}};
    const response = await worker.fetch(new Request(`https://shul.example${path}`), env);
    assert.equal(response.status, 200);
    assert.equal(assetPath, path);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('service-worker-allowed'), scope);
  }
});

test('renaming the public link leaves admin and private APIs protected', async () => {
  const env = {ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com', ACCESS_AUD:'test', ASSETS:{fetch:()=>{throw Error('private asset must not be fetched');}}};
  for (const path of ['/admin/display/', '/api/display/admin/items']) {
    const response = await worker.fetch(new Request(`https://shul.example${path}`), env);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('location'), null);
  }
});
