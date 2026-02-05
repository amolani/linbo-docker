import { useCallback, useRef, useState, DragEvent, ChangeEvent } from 'react';
import { ArrowUpTrayIcon, DocumentTextIcon, XMarkIcon } from '@heroicons/react/24/outline';

function clsxFn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export interface FileUploadProps {
  label?: string;
  error?: string;
  helperText?: string;
  accept?: string;
  maxSize?: number; // in bytes
  onFileSelect: (file: File | null) => void;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function FileUpload({
  label,
  error,
  helperText,
  accept = '.csv',
  maxSize = 10 * 1024 * 1024, // 10MB default
  onFileSelect,
  disabled = false,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file extension
      if (accept) {
        const acceptedExtensions = accept.split(',').map((ext) => ext.trim().toLowerCase());
        const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
        if (!acceptedExtensions.includes(fileExtension)) {
          return `Ungültiger Dateityp. Erlaubt: ${accept}`;
        }
      }
      // Check file size
      if (file.size > maxSize) {
        return `Datei zu groß. Maximal: ${formatFileSize(maxSize)}`;
      }
      return null;
    },
    [accept, maxSize]
  );

  const handleFile = useCallback(
    (file: File | null) => {
      if (file) {
        const validationError = validateFile(file);
        if (validationError) {
          setLocalError(validationError);
          setSelectedFile(null);
          onFileSelect(null);
          return;
        }
      }
      setLocalError(null);
      setSelectedFile(file);
      onFileSelect(file);
    },
    [validateFile, onFileSelect]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [disabled, handleFile]
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    setLocalError(null);
    onFileSelect(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [onFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  }, [disabled]);

  const displayError = error || localError;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clsxFn(
          'relative border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer',
          isDragging && 'border-primary-500 bg-primary-50',
          !!displayError && 'border-red-300 bg-red-50',
          !isDragging && !displayError && 'border-gray-300 hover:border-gray-400',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          disabled={disabled}
          className="hidden"
        />
        {selectedFile ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <DocumentTextIcon className="h-10 w-10 text-primary-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="p-1 hover:bg-gray-100 rounded-full"
              disabled={disabled}
            >
              <XMarkIcon className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        ) : (
          <div className="text-center">
            <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400" />
            <div className="mt-2">
              <p className="text-sm text-gray-600">
                <span className="font-medium text-primary-600 hover:text-primary-500">
                  Datei auswählen
                </span>{' '}
                oder hierher ziehen
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {accept} bis zu {formatFileSize(maxSize)}
              </p>
            </div>
          </div>
        )}
      </div>
      {displayError && <p className="mt-1 text-sm text-red-600">{displayError}</p>}
      {helperText && !displayError && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  );
}
