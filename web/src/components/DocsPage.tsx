import { DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import { Button, Space, Tag, Typography } from 'antd';
import { docsSections, installSteps, vscodeExtensionDownloadURL } from '../docsContent';

export function DocsPage() {
  return (
    <section className="docs-workspace">
      <div className="docs-hero">
        <div>
          <Typography.Title level={3}>Docs</Typography.Title>
          <Typography.Paragraph>
            Go Callchain Service 提供 Web 控制台和 VSCode 插件两种入口：Web 适合集中分析与可视化，VSCode 插件适合在代码编辑上下文里快速查看链路。
          </Typography.Paragraph>
        </div>
        <Button type="primary" size="large" icon={<DownloadOutlined />} href={vscodeExtensionDownloadURL}>
          下载 VSCode 插件
        </Button>
      </div>

      <div className="docs-grid">
        {docsSections.map((section) => (
          <article className="docs-panel" key={section.title}>
            <div className="docs-section-head">
              <Typography.Title level={4}>{section.title}</Typography.Title>
              <Typography.Text type="secondary">{section.summary}</Typography.Text>
            </div>
            <div className="docs-feature-list">
              {section.items.map((item) => (
                <div className="docs-feature" key={item.title}>
                  <Typography.Title level={5}>{item.title}</Typography.Title>
                  <Typography.Paragraph>{item.description}</Typography.Paragraph>
                  <Space wrap size={[6, 6]}>
                    {item.bullets.map((bullet) => (
                      <Tag key={bullet}>{bullet}</Tag>
                    ))}
                  </Space>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <article className="docs-panel docs-download-panel">
        <div>
          <Typography.Title level={4}>插件下载与安装</Typography.Title>
          <Typography.Paragraph>
            下载链接指向当前发布的 VSIX artifact。
          </Typography.Paragraph>
          <Typography.Link href={vscodeExtensionDownloadURL}>
            <LinkOutlined /> {vscodeExtensionDownloadURL}
          </Typography.Link>
        </div>
        <ol className="docs-steps">
          {installSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <pre className="docs-command">code --install-extension &lt;下载的 .vsix 文件&gt; --force</pre>
      </article>
    </section>
  );
}
