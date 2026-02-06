import { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Download } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { configsApi, RawConfigResponse } from '@/api/configs';
import { notify } from '@/stores/notificationStore';
import type { Config } from '@/types';

interface RawConfigEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config | null;
  onSaved?: () => void;
}

export function RawConfigEditorModal({
  isOpen,
  onClose,
  config,
  onSaved,
}: RawConfigEditorModalProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rawInfo, setRawInfo] = useState<RawConfigResponse | null>(null);

  const hasChanges = content !== originalContent;

  const loadContent = useCallback(async () => {
    if (!config) return;

    setIsLoading(true);
    try {
      const data = await configsApi.getRaw(config.id);
      setRawInfo(data);

      if (data.exists) {
        setContent(data.content);
        setOriginalContent(data.content);
      } else {
        // If file doesn't exist, load preview (generated from DB)
        const preview = await configsApi.preview(config.id);
        setContent(preview);
        setOriginalContent('');
        notify.info(
          'Neue Datei',
          'Die start.conf existiert noch nicht. Der Inhalt wurde aus der Datenbank generiert.'
        );
      }
    } catch (error) {
      notify.error('Fehler beim Laden der Konfiguration');
    } finally {
      setIsLoading(false);
    }
  }, [config]);

  useEffect(() => {
    if (isOpen && config) {
      loadContent();
    }
  }, [isOpen, config, loadContent]);

  const handleSave = async () => {
    if (!config) return;

    setIsSaving(true);
    try {
      await configsApi.saveRaw(config.id, content);
      setOriginalContent(content);
      notify.success('Gespeichert', 'Die start.conf wurde erfolgreich gespeichert.');
      onSaved?.();
    } catch (error) {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReload = async () => {
    if (hasChanges) {
      if (!confirm('Ungespeicherte Änderungen werden verworfen. Fortfahren?')) {
        return;
      }
    }
    await loadContent();
  };

  const handleClose = () => {
    if (hasChanges) {
      if (!confirm('Ungespeicherte Änderungen werden verworfen. Fortfahren?')) {
        return;
      }
    }
    setContent('');
    setOriginalContent('');
    setRawInfo(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      // Set cursor position after inserted spaces
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }

    // Ctrl+S to save
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (hasChanges && !isSaving) {
        handleSave();
      }
    }
  };

  const lineCount = content.split('\n').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <span>Raw Editor: {config?.name}</span>
          {hasChanges && (
            <span className="text-xs bg-yellow-600/20 text-yellow-400 px-2 py-0.5 rounded">
              Ungespeichert
            </span>
          )}
        </div>
      }
      size="xl"
    >
      <div className="space-y-4">
        {/* Info bar */}
        <div className="flex items-center justify-between text-sm text-muted-foreground bg-secondary rounded px-3 py-2">
          <div className="flex items-center gap-4">
            <span>
              <strong>Datei:</strong> {rawInfo?.filepath || `start.conf.${config?.name}`}
            </span>
            <span>
              <strong>Zeilen:</strong> {lineCount}
            </span>
          </div>
          {rawInfo?.lastModified && (
            <span>
              <strong>Zuletzt geändert:</strong>{' '}
              {new Date(rawInfo.lastModified).toLocaleString('de-DE')}
            </span>
          )}
        </div>

        {/* Editor */}
        <div className="relative">
          {isLoading ? (
            <div className="h-[500px] flex items-center justify-center bg-gray-900 rounded-lg">
              <div className="text-gray-400">Laden...</div>
            </div>
          ) : (
            <div className="relative">
              {/* Line numbers */}
              <div className="absolute left-0 top-0 bottom-0 w-12 bg-gray-800 rounded-l-lg overflow-hidden pointer-events-none">
                <div className="pt-3 pr-2 text-right text-gray-500 text-sm font-mono leading-6 select-none">
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i + 1}>{i + 1}</div>
                  ))}
                </div>
              </div>

              {/* Textarea */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full h-[500px] pl-14 pr-4 py-3 bg-gray-900 text-gray-100 font-mono text-sm leading-6 rounded-lg border-0 focus:ring-2 focus:ring-ring resize-none"
                style={{ tabSize: 2 }}
                spellCheck={false}
                placeholder="# LINBO start.conf"
              />
            </div>
          )}
        </div>

        {/* Help text */}
        <div className="text-xs text-muted-foreground">
          <strong>Tastenkürzel:</strong> Ctrl+S = Speichern, Tab = Einrücken
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReload}
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Neu laden
            </Button>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleClose}>
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              loading={isSaving}
            >
              <Download className="h-4 w-4 mr-1" />
              Speichern
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
