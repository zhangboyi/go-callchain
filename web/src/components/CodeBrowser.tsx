import { CodeOutlined, FileTextOutlined, FolderOutlined, SearchOutlined } from '@ant-design/icons';
import { Empty, Input, Space, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { CSSProperties, Key, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterFileTreeByFileName, searchFileTree } from '../codeSearch';
import type { FileContentResponse, FileTreeNode, FunctionDetail } from '../types';

const codeTreeDefaultWidth = 360;
const codeTreeMinWidth = 220;
const codeTreeMaxWidth = 760;
const codeViewMinWidth = 360;

interface CodeBrowserProps {
  tree: FileTreeNode | null;
  content: FileContentResponse | null;
  selectedFilePath: string;
  selectedFunctionID: string;
  functionDetail: FunctionDetail | null;
  onSelectFile: (path: string) => void;
  onSelectFunction: (node: FileTreeNode) => void;
}

interface CodeTreeDataNode extends DataNode {
  raw: FileTreeNode;
  children?: CodeTreeDataNode[];
}

export function CodeBrowser({
  tree,
  content,
  selectedFilePath,
  selectedFunctionID,
  functionDetail,
  onSelectFile,
  onSelectFunction,
}: CodeBrowserProps) {
  const treeData = useMemo(() => (tree ? [toTreeNode(tree)] : []), [tree]);
  const baseExpandedKeys = useMemo(() => (tree ? [tree.key, ...(tree.children?.slice(0, 8).map((node) => node.key) ?? [])] : []), [tree]);
  const selectedExpandedKeys = useMemo(() => expandedKeysForPath(selectedFilePath), [selectedFilePath]);
  const [fileSearch, setFileSearch] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [searchExpandedKeys, setSearchExpandedKeys] = useState<Key[]>([]);
  const [treeWidth, setTreeWidth] = useState(codeTreeDefaultWidth);
  const browserRef = useRef<HTMLDivElement>(null);
  const fileSearchResults = useMemo(() => searchFileTree(tree, fileSearch), [fileSearch, tree]);
  const filteredTree = useMemo(() => filterFileTreeByFileName(tree, fileSearch), [fileSearch, tree]);
  const filteredTreeData = useMemo(() => (filteredTree ? [toTreeNode(filteredTree)] : []), [filteredTree]);
  const filteredExpandedKeys = useMemo(() => (filteredTree ? directoryKeys(filteredTree) : []), [filteredTree]);
  const searchingFiles = fileSearch.trim().length > 0;
  const selectedKeys = selectedFunctionID ? [`fn:${selectedFunctionID}`] : selectedFilePath ? [`file:${selectedFilePath}`] : [];

  useEffect(() => {
    setExpandedKeys((current) => uniqueKeys([...current, ...baseExpandedKeys, ...selectedExpandedKeys]));
  }, [baseExpandedKeys, selectedExpandedKeys]);

  useEffect(() => {
    if (!searchingFiles) {
      return;
    }
    setSearchExpandedKeys(uniqueKeys([...filteredExpandedKeys, ...selectedExpandedKeys]));
  }, [filteredExpandedKeys, searchingFiles, selectedExpandedKeys]);

  function selectTreeNode(node: FileTreeNode) {
    if (node.type === 'file' && node.path) {
      onSelectFile(node.path);
    }
    if (node.type === 'function') {
      onSelectFunction(node);
    }
  }

  function resizeTree(nextWidth: number) {
    setTreeWidth(clamp(nextWidth, codeTreeMinWidth, maxTreeWidth(browserRef.current)));
  }

  function startTreeResize(event: ReactPointerEvent<HTMLDivElement>) {
    const browser = browserRef.current;
    if (!browser) {
      return;
    }
    event.preventDefault();

    const bounds = browser.getBoundingClientRect();
    const maxWidth = maxTreeWidth(browser);
    const updateWidth = (clientX: number) => {
      setTreeWidth(clamp(clientX - bounds.left, codeTreeMinWidth, maxWidth));
    };
    const stopResize = () => {
      document.body.classList.remove('code-resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      updateWidth(moveEvent.clientX);
    };

    document.body.classList.add('code-resizing');
    updateWidth(event.clientX);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }

  function handleResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    resizeTree(treeWidth + (event.key === 'ArrowRight' ? 24 : -24));
  }

  return (
    <div ref={browserRef} className="code-browser" style={{ '--code-tree-width': `${treeWidth}px` } as CSSProperties}>
      <div className="code-tree-wrap">
        <div className="code-file-search">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={fileSearch}
            onChange={(event) => setFileSearch(event.target.value)}
            onPressEnter={() => {
              const first = fileSearchResults[0]?.node;
              if (first?.path) {
                onSelectFile(first.path);
              }
            }}
            placeholder="Search file name"
          />
        </div>
        {treeData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No code tree" />
        ) : searchingFiles ? (
          filteredTreeData.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No file matched" />
          ) : (
            <Tree<CodeTreeDataNode>
              showIcon
              blockNode
              expandedKeys={searchExpandedKeys}
              selectedKeys={selectedKeys}
              treeData={filteredTreeData}
              onExpand={(keys) => setSearchExpandedKeys(keys)}
              onSelect={(_, info) => selectTreeNode(info.node.raw)}
            />
          )
        ) : (
          <Tree<CodeTreeDataNode>
            showIcon
            blockNode
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
            treeData={treeData}
            onExpand={(keys) => setExpandedKeys(keys)}
            onSelect={(_, info) => selectTreeNode(info.node.raw)}
          />
        )}
      </div>
      <div
        aria-label="Resize code tree"
        aria-orientation="vertical"
        className="code-tree-resizer"
        onKeyDown={handleResizeKey}
        onPointerDown={startTreeResize}
        role="separator"
        tabIndex={0}
      />
      <CodeView content={content} functionDetail={functionDetail} />
    </div>
  );
}

function CodeView({
  content,
  functionDetail,
}: {
  content: FileContentResponse | null;
  functionDetail: FunctionDetail | null;
}) {
  if (!content) {
    return <div className="graph-empty">Select a file or function</div>;
  }
  const highlight = functionDetail?.function.file === content.path ? functionDetail.function : null;
  const lines = content.content.split('\n');
  return (
    <div className="code-view" role="region" aria-label={content.path}>
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const highlighted = !!highlight && lineNumber >= highlight.start_line && lineNumber <= highlight.end_line;
        return (
          <div className={highlighted ? 'code-line code-line-highlight' : 'code-line'} key={`${content.path}-${lineNumber}`}>
            <span className="code-line-number">{lineNumber}</span>
            <code>{line || ' '}</code>
          </div>
        );
      })}
    </div>
  );
}

function toTreeNode(node: FileTreeNode): CodeTreeDataNode {
  return {
    key: node.key,
    raw: node,
    icon: iconForNode(node.type),
    title: titleForNode(node),
    children: node.children?.map(toTreeNode),
  };
}

function expandedKeysForPath(path: string): string[] {
  if (!path) {
    return [];
  }
  const parts = path.split('/').filter(Boolean);
  const keys: string[] = [];
  let current = '';
  for (let i = 0; i < parts.length; i += 1) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    keys.push(`${i === parts.length - 1 ? 'file' : 'directory'}:${current}`);
  }
  return keys;
}

function uniqueKeys(keys: Key[]): Key[] {
  return Array.from(new Set(keys));
}

function directoryKeys(node: FileTreeNode): Key[] {
  if (node.type !== 'directory') {
    return [];
  }
  return [node.key, ...(node.children ?? []).flatMap(directoryKeys)];
}

function maxTreeWidth(browser: HTMLDivElement | null): number {
  if (!browser) {
    return codeTreeMaxWidth;
  }
  return Math.max(codeTreeMinWidth, Math.min(codeTreeMaxWidth, browser.getBoundingClientRect().width - codeViewMinWidth));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function titleForNode(node: FileTreeNode) {
  if (node.type === 'function') {
    return (
      <Space size={6}>
        <Typography.Text code>{node.name}</Typography.Text>
        <Typography.Text type="secondary">{node.start_line}</Typography.Text>
      </Space>
    );
  }
  return <Typography.Text>{node.name}</Typography.Text>;
}

function iconForNode(type: FileTreeNode['type']) {
  switch (type) {
    case 'directory':
      return <FolderOutlined />;
    case 'file':
      return <FileTextOutlined />;
    default:
      return <CodeOutlined />;
  }
}
