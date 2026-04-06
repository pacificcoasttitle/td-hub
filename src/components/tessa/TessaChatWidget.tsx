'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTessa } from '@/contexts/TessaContext'
import { MessageCircle, X, Send, FileText, Loader2, Sparkles, Upload, Trash2 } from 'lucide-react'

export function TessaChatWidget() {
  const { messages, isLoading, isOpen, openChat, closeChat, sendMessage, analyzePdf, clearHistory } = useTessa()
  const [input, setInput] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    const message = input.trim()
    setInput('')
    await sendMessage(message)
  }

  const extractTextFromPdf = async (file: File): Promise<string> => {
    // Dynamic import to avoid SSR issues
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    
    let fullText = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item) => ('str' in item ? (item as { str: string }).str : ''))
        .join(' ')
      fullText += pageText + '\n\n'
    }
    
    return fullText
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    if (file.type !== 'application/pdf') {
      alert('Please select a PDF file')
      return
    }
    
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large. Please select a PDF under 10MB')
      return
    }
    
    setSelectedFile(file)
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return
    
    setExtracting(true)
    
    try {
      const text = await extractTextFromPdf(selectedFile)
      await analyzePdf(text, selectedFile.name)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      console.error('PDF extraction error:', err)
      alert('Failed to extract text from PDF. Please try another file.')
    } finally {
      setExtracting(false)
    }
  }, [selectedFile, analyzePdf])

  // Filter out system messages for display
  const displayMessages = messages.filter((m: { role: string }) => m.role !== 'system')

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={openChat}
          data-tessa-trigger
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-5 py-4 rounded-full shadow-lg transition-all hover:scale-105 hover:shadow-xl group"
        >
          <Sparkles className="w-5 h-5" />
          <span className="font-semibold">Ask TESSA™</span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
          </span>
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-48px)] h-[600px] max-h-[calc(100vh-100px)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 animate-in slide-in-from-bottom-4 fade-in duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-secondary to-secondary/90 text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold">TESSA™</h3>
                <p className="text-xs text-white/80">Title & Escrow AI Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {displayMessages.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  title="Clear chat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={closeChat}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {displayMessages.length === 0 && (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <h4 className="font-semibold text-gray-800 mb-2">Hi, I'm TESSA!</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Your AI-powered Title & Escrow assistant. Ask me about:
                </p>
                <div className="space-y-2 text-left max-w-xs mx-auto">
                  <SuggestionButton onClick={() => sendMessage("What is title insurance and why do I need it?")}>
                    What is title insurance?
                  </SuggestionButton>
                  <SuggestionButton onClick={() => sendMessage("What is the transfer tax in Los Angeles?")}>
                    Transfer tax in Los Angeles?
                  </SuggestionButton>
                  <SuggestionButton onClick={() => sendMessage("Explain the escrow process step by step")}>
                    Explain the escrow process
                  </SuggestionButton>
                  <SuggestionButton onClick={() => sendMessage("What tools does PCT offer for agents?")}>
                    PCT tools for agents?
                  </SuggestionButton>
                </div>
              </div>
            )}

            {displayMessages.map((message: { role: string; content: string }, index: number) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-primary text-white rounded-br-md'
                      : 'bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100'
                  }`}
                >
                  <TessaMessageContent content={message.content} isUser={message.role === 'user'} />
                </div>
              </div>
            ))}

            {(isLoading || extracting) && (
              <div className="flex justify-start">
                <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2 shadow-sm border border-gray-100">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm text-gray-600">
                    {extracting ? 'Extracting PDF text...' : 'TESSA is thinking...'}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* File Upload Preview */}
          {selectedFile && (
            <div className="px-4 py-2 bg-green-50 border-t border-green-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-green-700">
                <FileText className="w-4 h-4" />
                <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                <span className="text-green-600">({(selectedFile.size / 1024 / 1024).toFixed(1)}MB)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAnalyze}
                  disabled={extracting || isLoading}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Analyze
                </button>
                <button
                  onClick={() => {
                    setSelectedFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="p-1 hover:bg-green-100 rounded transition-colors"
                >
                  <X className="w-4 h-4 text-green-700" />
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 border-t bg-white">
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || extracting}
                className="p-3 border border-gray-300 hover:border-primary hover:bg-primary/5 disabled:opacity-50 rounded-xl transition-colors"
                title="Upload PDF for analysis"
              >
                <Upload className="w-5 h-5 text-gray-500" />
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about title, escrow, or transfer tax..."
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                disabled={isLoading || extracting}
              />
              <button
                type="submit"
                disabled={isLoading || extracting || !input.trim()}
                className="px-4 py-3 bg-primary hover:bg-primary/90 disabled:bg-gray-300 text-white rounded-xl transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Powered by AI • Upload a Prelim PDF for instant analysis
            </p>
          </form>
        </div>
      )}
    </>
  )
}

function SuggestionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors"
    >
      {children}
    </button>
  )
}

function TessaMessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  // Basic markdown-like formatting for assistant messages
  if (isUser) {
    return <p className="text-sm leading-relaxed">{content}</p>
  }

  // Format bold text and line breaks
  const lines = content.split('\n')
  
  return (
    <div className="text-sm leading-relaxed space-y-2">
      {lines.map((line, i) => {
        if (!line.trim()) return null
        
        // Check for headers (lines starting with **)
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <p key={i} className="font-semibold text-secondary mt-3 first:mt-0">
              {line.replace(/\*\*/g, '')}
            </p>
          )
        }
        
        // Check for bullet points
        if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
          return (
            <p key={i} className="pl-3 relative before:absolute before:left-0 before:content-['•'] before:text-primary">
              {line.replace(/^[-•]\s*/, '')}
            </p>
          )
        }
        
        // Regular paragraphs - handle inline bold
        const formattedLine = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        
        return (
          <p 
            key={i} 
            dangerouslySetInnerHTML={{ __html: formattedLine }}
          />
        )
      })}
    </div>
  )
}
