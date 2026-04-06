'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface TessaContextValue {
  messages: Message[];
  isLoading: boolean;
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  sendMessage: (content: string) => Promise<void>;
  analyzePdf: (text: string, fileName: string) => Promise<void>;
  clearHistory: () => void;
}

const TessaCtx = createContext<TessaContextValue | null>(null);

export function TessaProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const clearHistory = useCallback(() => setMessages([]), []);

  const sendMessage = useCallback(async (content: string) => {
    setMessages(prev => [...prev, { role: 'user', content }]);
    setIsLoading(true);
    try {
      const res = await fetch('/api/tessa/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      const data = await res.json().catch(() => ({ reply: 'Sorry, something went wrong.' }));
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? data.message ?? 'No response.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I could not process your request.' }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const analyzePdf = useCallback(async (text: string, fileName: string) => {
    setMessages(prev => [
      ...prev,
      { role: 'user', content: `📄 Analyze prelim: ${fileName}` },
    ]);
    setIsLoading(true);
    try {
      const res = await fetch('/api/tessa/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Analyze this prelim document:\n\n${text.slice(0, 8000)}`, fileName }),
      });
      const data = await res.json().catch(() => ({ reply: 'Analysis unavailable.' }));
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? data.message ?? 'Analysis complete.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'PDF analysis failed. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <TessaCtx.Provider value={{ messages, isLoading, isOpen, openChat, closeChat, sendMessage, analyzePdf, clearHistory }}>
      {children}
    </TessaCtx.Provider>
  );
}

export function useTessa(): TessaContextValue {
  const ctx = useContext(TessaCtx);
  if (!ctx) throw new Error('useTessa must be used within TessaProvider');
  return ctx;
}
