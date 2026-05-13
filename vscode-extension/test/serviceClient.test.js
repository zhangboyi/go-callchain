const assert = require('node:assert/strict');
const test = require('node:test');

const { ServiceClient } = require('../dist/serviceClient');

test('service client lists routes for a task', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      routes: [
        {
          method: 'GET',
          path: '/api/users',
          handler: 'pkg.UserHandler.List',
          file: 'handler.go',
          line: 12,
        },
      ],
    });
  };

  const client = new ServiceClient('http://127.0.0.1:8787');
  const routes = await client.listRoutes('task 1');

  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/v1/routes?task_id=task%201');
  assert.equal(routes[0].method, 'GET');
  assert.equal(routes[0].path, '/api/users');
});

test('service client requests interface callchain by route', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      route: {
        method: 'POST',
        path: '/api/users',
        handler: 'pkg.UserHandler.Create',
        file: 'handler.go',
        line: 20,
      },
      tree: {
        function: 'pkg.UserHandler.Create',
        children: [{ function: 'pkg.UserService.Create', children: [] }],
      },
    });
  };

  const client = new ServiceClient('http://127.0.0.1:8787');
  const callchain = await client.interfaceCallchain('task-1', 'POST', '/api/users', 8);

  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/v1/callchain/interface');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    task_id: 'task-1',
    method: 'POST',
    path: '/api/users',
    depth: 8,
  });
  assert.equal(callchain.route.handler, 'pkg.UserHandler.Create');
  assert.equal(callchain.tree.children[0].function, 'pkg.UserService.Create');
});

function jsonResponse(payload) {
  return {
    ok: true,
    text: async () => JSON.stringify(payload),
  };
}
