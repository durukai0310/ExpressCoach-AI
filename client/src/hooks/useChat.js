import { useState, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { trackEvent } from '../utils/tracker';

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('general');
  const messagesEndRef = useRef(null);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: text.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    trackEvent('chat_send', '/chat', 'send-button');

    try {
      const data = await api.post('/chat', {
        message: text.trim(),
        category,
      });

      const aiMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.reply,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (err) {
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `抱歉，发送消息时出现了问题：${err.message}。请稍后再试。`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }, [loading, category]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.get('/chat/history');
      if (data.history && data.history.length > 0) {
        setMessages(data.history);
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    try {
      await api.delete('/chat/history');
      setMessages([]);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  }, []);

  const changeCategory = useCallback((newCategory) => {
    setCategory(newCategory);
    trackEvent('click', '/chat', `category-${newCategory}`);
  }, []);

  return {
    messages,
    loading,
    category,
    messagesEndRef,
    sendMessage,
    loadHistory,
    clearHistory,
    changeCategory,
  };
}
