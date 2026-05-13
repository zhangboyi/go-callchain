export const vscodeExtensionDownloadURL = '/api/v1/downloads/vscode-extension';

export interface DocsFeature {
  title: string;
  description: string;
  bullets: string[];
}

export interface DocsSection {
  title: string;
  summary: string;
  items: DocsFeature[];
}

export const docsSections: DocsSection[] = [
  {
    title: 'Web 功能',
    summary: '面向浏览器的完整分析控制台，适合集中管理仓库、查看接口调用链和做 MR 影响面分析。',
    items: [
      {
        title: '仓库与分析任务',
        description: '支持 Local、Git、Saved 三类仓库来源，Saved 仓库可同步远程 refs 后再分析。',
        bullets: ['本地目录直接分析', 'Git URL + ref 临时分析', '受管仓库保存、同步、切换分支或 tag'],
      },
      {
        title: '接口与函数调用链',
        description: '接口列表、函数列表、调用树、调用图和边证据在同一工作台内联动。',
        bullets: ['按接口入口展开链路', '按函数 ID 搜索调用链', '调用图支持节点拖拽、折叠和变更节点高亮'],
      },
      {
        title: 'MR Impact',
        description: '按 base/head 对比代码变更，识别变更函数和受影响接口。',
        bullets: ['展示 Changed Functions 和 Impacted Interfaces', '链路图中突出标识变更方法', '支持远程分支、tag 或 commit 输入'],
      },
      {
        title: 'Code Browser',
        description: '在 Web 内查看文件树和源码，函数详情可联动源码位置、入边、出边。',
        bullets: ['源码行高亮', '文件树函数节点定位', 'Raw JSON 便于排查和二次分析'],
      },
    ],
  },
  {
    title: 'VSCode 插件功能',
    summary: '面向日常开发的编辑器侧入口，适合在代码上下文里查看链路、跳源码和分析本地分支影响。',
    items: [
      {
        title: 'VSCode 侧边栏',
        description: 'Code Analysis 活动栏内区分 Interface Callchain、Function Callchain 和 MR Impact。',
        bullets: ['接口列表作为接口调用链入口', '函数调用链按当前函数展开', 'MR Impact 展示变更函数和受影响接口'],
      },
      {
        title: 'CodeLens 与图谱',
        description: '在 Go 函数上直接触发 Explain、Doc、Show Callchain，并可打开调用链 Graph。',
        bullets: ['点击树节点跳转源码', '右侧图标查看当前节点起始的 Graph', '图谱内支持节点操作和 Graph Actions'],
      },
      {
        title: '分析目录与服务',
        description: '插件可选择分析目录，默认自动识别 go.mod，并自动启动内置 go-callchain-service。',
        bullets: ['选择或清除分析目录', '配置 serviceUrl、serviceBinary、defaultBase', '重启插件内置服务'],
      },
    ],
  },
];

export const installSteps = [
  '下载 VSIX 文件',
  '在 VSCode 执行 Extensions: Install from VSIX...',
  '选择下载的 go-callchain-vscode-*.vsix 后重载窗口',
];
