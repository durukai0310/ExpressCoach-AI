import { useEffect, useRef } from 'react';
import { useChat } from '../hooks/useChat';
import MessageBubble from '../components/MessageBubble';

const CATEGORIES = [
  { key: 'general', label: '综合', icon: '🧠' },
  { key: 'career', label: '职业', icon: '💼' },
  { key: 'study', label: '学习', icon: '📚' },
  { key: 'life', label: '生活', icon: '🌱' },
];

export default function Chat() {
  const {
    messages,
    loading,
    category,
    messagesEndRef,
    sendMessage,
    loadHistory,
    clearHistory,
    changeCategory,
  } = useChat();

  const inputRef = useRef(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      loadHistory();
      initialized.current = true;
    }
  }, [loadHistory]);

  const handleSend = () => {
    const text = inputRef.current?.value?.trim();
    if (text) {
      sendMessage(text);
      inputRef.current.value = '';
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesEndRef]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <div>
          <h1 className="page-title">AI 教练对话</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>随时随地的个性化指导</p>
        </div>
        {messages.length > 0 && (
          <button
            className="btn btn-sm btn-outline"
            onClick={clearHistory}
            data-track="clear-chat"
          >
            清空对话
          </button>
        )}
      </div>

      <div className="chat-page">
        {/* Category Sidebar */}
        <div className="chat-sidebar">
          <h3>对话类别</h3>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              className={`category-btn ${category === cat.key ? 'active' : ''}`}
              onClick={() => changeCategory(cat.key)}
              data-track={`category-${cat.key}`}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Chat Main */}
        <div className="chat-main">
          <div className="chat-messages">
            {messages.length === 0 && !loading && (
              <div className="empty-state">
                <span className="icon">🤖</span>
                <h3>欢迎来到 ExpressCoach！</h3>
                <p>
                  我是你的 AI 教练，可以在职业发展、学习方法、生活平衡等方面为你提供指导。
                </p>
                <p style={{ color: 'var(--color-text-lighter)', fontSize: '0.9rem', marginTop: 'var(--space-md)' }}>
                  选择一个对话类别，然后开始我们的对话吧 👇
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {loading && (
              <div className="message message-ai">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <input
              ref={inputRef}
              type="text"
              className="chat-input"
              placeholder={`向${CATEGORIES.find(c => c.key === category)?.label}教练提问...`}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={loading || !inputRef.current?.value?.trim()}
              data-track="send-message"
              title="发送"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
