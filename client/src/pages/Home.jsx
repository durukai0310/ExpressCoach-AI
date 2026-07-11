import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div>
      <section className="hero">
        <h1>社交表达教练<br />懂关系 · 会说话</h1>
        <p>
          ExpressCoach 不是聊天机器人——它理解你的社交关系结构，
          通过意图识别、关系分析、多版本话术生成，帮你找到最合适的表达方式。
        </p>
        <Link to="/analyze" className="btn btn-primary btn-lg" data-track="hero-cta">
          🔍 开始分析
        </Link>
      </section>

      <section className="features">
        <div className="card">
          <span className="feature-icon">🔍</span>
          <h3 className="card-title">全链路场景分析</h3>
          <p className="card-description">
            输入社交场景，AI 自动识别意图类型（拒绝/催促/反馈/设边界/求助），
            分析关系结构（亲密度/权力/利益），生成三种差异化表达方案。
          </p>
        </div>

        <div className="card">
          <span className="feature-icon">🎮</span>
          <h3 className="card-title">对话沙盒练习</h3>
          <p className="card-description">
            在安全环境中与 AI 模拟的对方对话，教练实时指导。
            支持自由/引导/压力三种模式，友善/刁难/回避三种对方性格。
          </p>
        </div>

        <div className="card">
          <span className="feature-icon">📊</span>
          <h3 className="card-title">数据收集与洞察</h3>
          <p className="card-description">
            所有分析案例自动保存，用户反馈记录评分。
            问卷和测试收集体验数据，可视化仪表盘展示使用趋势和统计。
          </p>
        </div>

        <div className="card">
          <span className="feature-icon">📝</span>
          <h3 className="card-title">使用体验反馈</h3>
          <p className="card-description">
            通过问卷和评估测试收集你的使用体验和社交习惯，
            帮助我们持续优化意图识别模型和表达生成质量。
          </p>
        </div>

        <div className="card">
          <span className="feature-icon">🔗</span>
          <h3 className="card-title">轻松分享</h3>
          <p className="card-description">
            一键生成公网链接，分享给朋友、同事体验。
            无需注册登录，打开即用。所有交互数据自动收集和分析。
          </p>
        </div>

        <div className="card">
          <span className="feature-icon">🆓</span>
          <h3 className="card-title">免费使用</h3>
          <p className="card-description">
            基于 DeepSeek API，新用户注册即获 500 万 token 免费额度。
            全中文优化，专注中文社交场景的细微表达差异。
          </p>
        </div>
      </section>

      <section style={{ textAlign: 'center', padding: '48px 0' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', marginBottom: 16 }}>
          立即体验 ExpressCoach
        </h2>
        <p style={{ color: 'var(--color-text-light)', maxWidth: 500, margin: '0 auto 32px' }}>
          无需注册，无需付费。输入你的社交困境，AI 帮你找到最合适的表达方式。
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/analyze" className="btn btn-primary btn-lg" data-track="home-analyze">🔍 场景分析</Link>
          <Link to="/sandbox" className="btn btn-outline btn-lg" data-track="home-sandbox">🎮 对话练习</Link>
          <Link to="/surveys" className="btn btn-outline btn-lg" data-track="home-survey">📝 填写问卷</Link>
        </div>
      </section>
    </div>
  );
}
