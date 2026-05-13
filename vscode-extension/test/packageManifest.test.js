const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('view title navigation commands use icons instead of long labels', () => {
  const commands = new Map(manifest.contributes.commands.map((item) => [item.command, item]));
  const titleCommands = manifest.contributes.menus['view/title']
    .filter((item) => item.group?.startsWith('navigation'))
    .map((item) => commands.get(item.command));

  assert.ok(titleCommands.length > 0);
  for (const command of titleCommands) {
    assert.ok(command.icon, `${command.command} should define icon`);
  }
});

test('view title exposes analysis entry commands', () => {
  const titleCommands = manifest.contributes.menus['view/title'].map((item) => item.command);

  assert.ok(titleCommands.includes('goCallchain.analyzeWorkspace'));
  assert.ok(titleCommands.includes('goCallchain.analyzeLocalBranchImpact'));
  assert.ok(titleCommands.includes('goCallchain.showInterfaceCallchain'));
  assert.ok(titleCommands.includes('goCallchain.showFunctionCallchain'));
});

test('interface callchain toolbar owns route analysis actions', () => {
  const callchainCommands = manifest.contributes.menus['view/title']
    .filter((item) => item.when === 'view == goCallchain.interfaceCallchainView')
    .map((item) => item.command);

  assert.deepEqual(callchainCommands, [
    'goCallchain.analyzeWorkspace',
    'goCallchain.showInterfaceCallchain',
    'goCallchain.showCallchainGraph',
    'goCallchain.moreInterfaceActions',
  ]);
});

test('mr impact toolbar keeps impact actions separate from callchain actions', () => {
  const impactCommands = manifest.contributes.menus['view/title']
    .filter((item) => item.when === 'view == goCallchain.impactView')
    .map((item) => item.command);

  assert.deepEqual(impactCommands, [
    'goCallchain.analyzeLocalBranchImpact',
    'goCallchain.moreImpactActions',
  ]);
});

test('function callchain toolbar owns function analysis actions', () => {
  const callchainCommands = manifest.contributes.menus['view/title']
    .filter((item) => item.when === 'view == goCallchain.functionCallchainView')
    .map((item) => item.command);

  assert.deepEqual(callchainCommands, [
    'goCallchain.analyzeWorkspace',
    'goCallchain.showFunctionCallchain',
    'goCallchain.showCallchainGraph',
    'goCallchain.moreFunctionActions',
  ]);
});

test('toolbar commands expose concise tooltips through command titles', () => {
  const commands = new Map(manifest.contributes.commands.map((item) => [item.command, item]));

  assert.equal(commands.get('goCallchain.analyzeWorkspace').title, '分析工作区');
  assert.equal(commands.get('goCallchain.analyzeLocalBranchImpact').title, '分析 MR Impact');
  assert.equal(commands.get('goCallchain.showInterfaceCallchain').title, '查看接口调用链');
  assert.equal(commands.get('goCallchain.showCallchainGraph').title, '查看 Graph');
  assert.equal(commands.get('goCallchain.moreInterfaceActions').title, '接口更多操作');
  assert.equal(commands.get('goCallchain.moreImpactActions').title, 'MR 更多操作');
  assert.equal(commands.get('goCallchain.moreFunctionActions').title, '函数更多操作');
});

test('view title uses distinct more actions per workflow view', () => {
  const titleCommands = manifest.contributes.menus['view/title'].map((item) => item.command);

  assert.ok(titleCommands.includes('goCallchain.moreInterfaceActions'));
  assert.ok(titleCommands.includes('goCallchain.moreImpactActions'));
  assert.ok(titleCommands.includes('goCallchain.moreFunctionActions'));
  assert.ok(!titleCommands.includes('goCallchain.moreActions'));
  assert.ok(!titleCommands.includes('goCallchain.refresh'));
  assert.ok(!titleCommands.includes('goCallchain.selectAnalysisDirectory'));
});

test('tree item inline actions expose graph navigation only', () => {
  const itemCommands = manifest.contributes.menus['view/item/context'] ?? [];
  const inlineCommands = itemCommands.map((item) => item.command);

  assert.deepEqual(inlineCommands, ['goCallchain.showSelectedCallchainGraph']);
  assert.equal(itemCommands[0].group, 'inline');
  assert.equal(itemCommands[0].when, 'viewItem =~ /goCallchain.function/');
  assert.ok(!inlineCommands.includes('goCallchain.openFunction'));
  assert.ok(!inlineCommands.includes('goCallchain.showCallchainGraph'));
  assert.ok(!inlineCommands.includes('goCallchain.showTreeFunctionCallchain'));

  const contributedCommands = manifest.contributes.commands.map((item) => item.command);
  assert.ok(contributedCommands.includes('goCallchain.showSelectedCallchainGraph'));
  assert.ok(!contributedCommands.includes('goCallchain.showTreeFunctionCallchain'));
});

test('activity container is named Code Analysis', () => {
  const container = manifest.contributes.viewsContainers.activitybar.find((item) => item.id === 'goCallchain');

  assert.equal(container.title, 'Code Analysis');
});

test('views separate interface callchain, mr impact, and function callchain', () => {
  const views = manifest.contributes.views.goCallchain;
  const interfaceView = views.find((view) => view.id === 'goCallchain.interfaceCallchainView');
  const impactView = views.find((view) => view.id === 'goCallchain.impactView');
  const functionView = views.find((view) => view.id === 'goCallchain.functionCallchainView');

  assert.equal(interfaceView.name, 'Interface Callchain');
  assert.equal(impactView.name, 'MR Impact');
  assert.equal(functionView.name, 'Function Callchain');
});
