import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const COLORS = ['#6b8f71', '#c4946c', '#d4a76a', '#7a9cc6', '#b08bbf', '#e07070'];

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [testStats, setTestStats] = useState(null);
  const [behaviorStats, setBehaviorStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [summaryRes, testRes, behaviorRes] = await Promise.all([
        api.get('/analytics/summary'),
        api.get('/analytics/test-stats'),
        api.get('/analytics/behavior'),
      ]);
      setSummary(summaryRes.summary);
      setTestStats(testRes);
      setBehaviorStats(behaviorRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div> 加载仪表盘...</div>;
  if (error) return <div className="error-state">加载失败：{error}</div>;

  const pieData = (testStats?.stats || []).map(s => ({
    name: s.title,
    value: s.responseCount,
  })).filter(d => d.value > 0);

  const barData = (testStats?.stats || []).map(s => ({
    name: s.title.length > 10 ? s.title.substring(0, 10) + '...' : s.title,
    平均分: s.avgPercentage,
    参与人数: s.responseCount,
  }));

  const lineData = (testStats?.dailyChats || []).map(d => ({
    date: d.day?.substring(5) || d.day,
    消息数: d.count,
  }));

  const pageViewData = (behaviorStats?.stats?.pageViews || []).map(p => ({
    name: p.page === '/' ? '首页' :
      p.page === '/chat' ? '对话' :
      p.page === '/surveys' ? '问卷' :
      p.page === '/tests' ? '测试' :
      p.page === '/dashboard' ? '仪表盘' : p.page,
    value: p.count,
  })).filter(d => d.value > 0);

  return (
    <div className="dashboard">
      <h1 className="page-title">📊 数据仪表盘</h1>
      <p className="page-subtitle">实时查看所有用户的互动数据和分析</p>

      {/* Stat Tiles */}
      <div className="stat-tiles">
        <div className="stat-tile">
          <div className="stat-value">{summary?.totalUsers || 0}</div>
          <div className="stat-label">👤 总用户数</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{summary?.totalConversations || 0}</div>
          <div className="stat-label">💬 总对话数</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{summary?.totalSurveyResponses || 0}</div>
          <div className="stat-label">📝 问卷回答</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{summary?.totalTestResults || 0}</div>
          <div className="stat-label">🧪 测试结果</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{summary?.totalBehaviorEvents || 0}</div>
          <div className="stat-label">📈 行为事件</div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">
        {/* Daily chat activity */}
        <div className="chart-card">
          <h3>📈 每日对话趋势（近7天）</h3>
          {lineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                <XAxis dataKey="date" stroke="#8a8078" fontSize={12} />
                <YAxis stroke="#8a8078" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e5e0d8',
                    borderRadius: '6px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="消息数"
                  stroke="#6b8f71"
                  strokeWidth={2}
                  dot={{ fill: '#6b8f71', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <p>暂无对话数据</p>
            </div>
          )}
        </div>

        {/* Test score bar chart */}
        <div className="chart-card">
          <h3>📊 测试平均得分率</h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                <XAxis dataKey="name" stroke="#8a8078" fontSize={11} />
                <YAxis stroke="#8a8078" fontSize={12} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e5e0d8',
                    borderRadius: '6px',
                  }}
                  formatter={(value) => [`${value}%`, '平均得分率']}
                />
                <Bar dataKey="平均分" fill="#6b8f71" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <p>暂无测试数据</p>
            </div>
          )}
        </div>

        {/* Test distribution pie chart */}
        <div className="chart-card">
          <h3>🍩 测试参与分布</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <p>暂无测试参与数据</p>
            </div>
          )}
        </div>

        {/* Page view distribution */}
        <div className="chart-card">
          <h3>👁️ 页面访问分布（近7天）</h3>
          {pageViewData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={pageViewData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                <XAxis type="number" stroke="#8a8078" fontSize={12} allowDecimals={false} />
                <YAxis dataKey="name" type="category" stroke="#8a8078" fontSize={12} width={50} />
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e5e0d8',
                    borderRadius: '6px',
                  }}
                />
                <Bar dataKey="value" fill="#c4946c" radius={[0, 4, 4, 0]} name="访问次数" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <p>暂无页面访问数据</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent behavior events table */}
      {behaviorStats?.recent && behaviorStats.recent.length > 0 && (
        <div className="chart-card" style={{ marginTop: 'var(--space-lg)' }}>
          <h3>📋 最近行为事件</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'left', color: 'var(--color-text-light)' }}>事件类型</th>
                  <th style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'left', color: 'var(--color-text-light)' }}>页面</th>
                  <th style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'left', color: 'var(--color-text-light)' }}>元素</th>
                  <th style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'left', color: 'var(--color-text-light)' }}>时间</th>
                </tr>
              </thead>
              <tbody>
                {behaviorStats.recent.slice(0, 20).map((ev, i) => (
                  <tr key={ev.id || i} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '0.8rem',
                        background: ev.event_type === 'page_view' ? '#e8f0e9' :
                                    ev.event_type === 'click' ? '#fdf0e4' :
                                    ev.event_type === 'chat_send' ? '#e4eef8' : '#f0ece5',
                        color: ev.event_type === 'page_view' ? '#6b8f71' :
                               ev.event_type === 'click' ? '#c4946c' :
                               ev.event_type === 'chat_send' ? '#7a9cc6' : '#8a8078',
                      }}>
                        {ev.event_type}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-light)' }}>{ev.page || '-'}</td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-light)' }}>{ev.element || '-'}</td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-lighter)', fontSize: '0.85rem' }}>
                      {ev.created_at ? new Date(ev.created_at).toLocaleString('zh-CN') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
