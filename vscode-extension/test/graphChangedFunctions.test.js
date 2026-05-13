const assert = require('node:assert/strict');
const test = require('node:test');

const { changedFunctionIDSet } = require('../dist/graphChangedFunctions');

test('graph changed function set includes MR changed function ids', () => {
  const ids = changedFunctionIDSet([
    { id: 'service.OrderService.Detail', file: 'service/order.go', start_line: 12, end_line: 28 },
  ]);

  assert.ok(ids.has('service.OrderService.Detail'));
  assert.ok(!ids.has('dao.OrderDao.GetById'));
});
