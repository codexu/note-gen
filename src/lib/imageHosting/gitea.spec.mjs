import assert from 'node:assert/strict'
import { test } from 'node:test'
import { File } from 'node:buffer'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const config = { baseUrl: 'https://git.example.org/gitea/', repository: 'team/images', token: 'secret', pathPrefix: 'images/截图' }
let saved, handler, requests
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('./gitea.ts', import.meta.url))],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false,
})
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(name => {
  if (name === '@tauri-apps/plugin-store') return { Store: { load: async () => ({ get: async key => saved[key] }) } }
  if (name === '@tauri-apps/plugin-http') return { fetch: async (url, options) => { requests.push({ url, options }); return handler(url, options) } }
  if (name === 'uuid') return { v4: () => 'image-id' }
  return require(name)
}, compiledModule, compiledModule.exports)
const { isGiteaImageConfigComplete, testGiteaImageConnection, uploadImageByGitea } = compiledModule.exports
const reset = () => { saved = { giteaImageConfig: { ...config }, proxy: 'http://proxy:8080' }; requests = [] }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('validates the instance URL, owner/repo, token and upload folder', () => {
  assert.equal(isGiteaImageConfigComplete(config), true)
  for (const change of [{ baseUrl: 'file:///tmp' }, { baseUrl: 'https://user:password@git.test' }, { baseUrl: 'https://git.test?token=secret' }, { repository: 'images' }, { repository: '../images' }, { token: '' }, { pathPrefix: '../images' }]) {
    assert.equal(isGiteaImageConfigComplete({ ...config, ...change }), false)
  }
})

test('checks a writable public repository and optional branch without creating files', async () => {
  reset(); handler = () => json({ private: false, permissions: { push: true } })
  assert.equal(await testGiteaImageConnection(config), true)
  assert.equal(requests[0].url, 'https://git.example.org/gitea/api/v1/repos/team/images')
  assert.equal(requests[0].options.headers.Authorization, 'token secret')
  assert.deepEqual(requests[0].options.proxy, { all: 'http://proxy:8080' })
  assert.ok(requests.every(request => request.options.method === 'GET'))
  assert.equal(await testGiteaImageConnection({ ...config, baseUrl: 'https://git.example.org/gitea/api/v1/', branch: 'release/v1' }), true)
  assert.equal(requests.at(-1).url, 'https://git.example.org/gitea/api/v1/repos/team/images/branches/release%2Fv1')
  for (const body of [{ private: true, permissions: { push: true } }, { archived: true, permissions: { push: true } }, { permissions: { push: false } }]) {
    handler = () => json(body); assert.equal(await testGiteaImageConnection(config), false)
  }
  handler = () => json({}, 404); assert.equal(await testGiteaImageConnection(config), false)
})

test('uploads exact binary bytes with encoded paths and preserves the returned URL', async () => {
  reset(); handler = () => json({ content: { download_url: 'https://git.example.org/team/images/raw/branch/main/image-id.svg' } }, 201)
  const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256)
  const url = await uploadImageByGitea(new File([bytes], 'drawing.svg', { type: 'image/svg+xml' }))
  assert.equal(url, 'https://git.example.org/team/images/raw/branch/main/image-id.svg')
  const request = requests[0]
  assert.equal(request.options.method, 'POST')
  assert.equal(request.url, 'https://git.example.org/gitea/api/v1/repos/team/images/contents/images/%E6%88%AA%E5%9B%BE/image-id.svg')
  const body = JSON.parse(request.options.body)
  assert.deepEqual(Buffer.from(body.content, 'base64'), Buffer.from(bytes))
  assert.equal(Object.hasOwn(body, 'branch'), false)
  saved.giteaImageConfig.branch = 'release/v1'
  await uploadImageByGitea(new File([bytes], 'photo.png'))
  assert.equal(JSON.parse(requests.at(-1).options.body).branch, 'release/v1')
})

test('does not upload incomplete configurations or accept failed or malformed responses', async () => {
  reset(); saved.giteaImageConfig.token = ''
  assert.equal(await uploadImageByGitea(new File(['x'], 'photo.png')), undefined)
  assert.equal(requests.length, 0)
  reset(); handler = () => json({ message: 'denied' }, 403)
  await assert.rejects(uploadImageByGitea(new File(['x'], 'photo.png')), /403/)
  for (const body of [{}, { content: {} }, { content: { download_url: 'javascript:alert(1)' } }]) {
    handler = () => json(body)
    await assert.rejects(uploadImageByGitea(new File(['x'], 'photo.png')), /download URL/)
  }
})
