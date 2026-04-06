'use client'

import { useRef, useState, useCallback } from 'react'
import { Upload, FileText, X } from 'lucide-react'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function TessaPrelimUploader({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const validate = useCallback((file: File): string | null => {
    if (file.type !== 'application/pdf') return 'Please select a PDF file.'
    if (file.size > 10 * 1024 * 1024) return 'File too large — please select a PDF under 10 MB.'
    return null
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      const err = validate(file)
      if (err) {
        setError(err)
        setSelectedFile(null)
        return
      }
      setError(null)
      setSelectedFile(file)
    },
    [validate]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleAnalyze = useCallback(() => {
    if (selectedFile) onFile(selectedFile)
  }, [selectedFile, onFile])

  const handleClear = useCallback(() => {
    setSelectedFile(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  return (
    <div className="w-full space-y-4">
      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer
          ${dragOver ? 'border-orange-400 bg-orange-50' : 'border-gray-300 bg-gray-50 hover:border-orange-300 hover:bg-orange-50/40'}
          ${disabled ? 'opacity-50 pointer-events-none' : ''}
        `}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />

        {selectedFile ? (
          <div className="flex items-center justify-center gap-3">
            <FileText className="text-orange-500" size={32} />
            <div className="text-left">
              <p className="font-semibold text-gray-800">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button
              type="button"
              className="ml-2 p-1 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
              onClick={(e) => { e.stopPropagation(); handleClear() }}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className="mx-auto text-gray-400" size={36} />
            <p className="text-gray-600 font-medium">Drag & drop your Preliminary Title Report here</p>
            <p className="text-sm text-gray-400">or click to browse — PDF only, max 10 MB</p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          ❌ {error}
        </p>
      )}

      {/* Analyze button */}
      {selectedFile && !error && (
        <button
          type="button"
          disabled={disabled}
          onClick={handleAnalyze}
          className="w-full py-3 px-6 rounded-xl bg-[#f26b2b] hover:bg-[#e05a1f] text-white font-bold text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
        >
          📄 Analyze with TESSA™
        </button>
      )}
    </div>
  )
}
