import { useState, useCallback } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { Modal, Button, FileUpload } from '@/components/ui';
import { hostsApi, ImportResult, ImportValidationResult } from '@/api/hosts';
import { notify } from '@/stores/notificationStore';

interface ImportHostsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'validate' | 'confirm' | 'result';

const CSV_FORMAT_HELP = `CSV-Format (linuxmuster-kompatibel):
room;hostname;group;mac;ip;field5;field6;dhcp_options;field8;role;field10;pxe

Beispiel:
r100;pc01;win11;AA:BB:CC:DD:EE:01;10.0.10.1;;;;workstation;;1
r100;pc02;win11;AA:BB:CC:DD:EE:02;10.0.10.2;;;;workstation;;1

Pflichtfelder: hostname, mac
Optional: room, group, ip, role, pxe`;

export function ImportHostsModal({ isOpen, onClose, onSuccess }: ImportHostsModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [_file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setCsvContent('');
    setValidationResult(null);
    setImportResult(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFileSelect = useCallback(async (selectedFile: File | null) => {
    setFile(selectedFile);
    setError(null);
    if (selectedFile) {
      try {
        const text = await selectedFile.text();
        setCsvContent(text);
      } catch {
        setError('Fehler beim Lesen der Datei');
      }
    } else {
      setCsvContent('');
    }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!csvContent) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await hostsApi.importValidate(csvContent);
      setValidationResult(result);
      setStep('validate');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Validierung fehlgeschlagen';
      setError(message);
      notify.error('Validierungsfehler', message);
    } finally {
      setIsLoading(false);
    }
  }, [csvContent, notify]);

  const handleImport = useCallback(async () => {
    if (!csvContent) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await hostsApi.import(csvContent);
      setImportResult(result);
      setStep('result');

      if (result.success) {
        notify.success(
          'Import erfolgreich',
          `${result.created} erstellt, ${result.updated} aktualisiert`
        );
        onSuccess();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import fehlgeschlagen';
      setError(message);
      notify.error('Import fehlgeschlagen', message);
    } finally {
      setIsLoading(false);
    }
  }, [csvContent, notify, onSuccess]);

  const renderStep = () => {
    switch (step) {
      case 'upload':
        return (
          <div className="space-y-4">
            <FileUpload
              label="CSV-Datei auswählen"
              accept=".csv"
              maxSize={5 * 1024 * 1024}
              onFileSelect={handleFileSelect}
              helperText="Maximal 5 MB"
            />

            {csvContent && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-600">
                  {csvContent.split('\n').filter((l) => l.trim()).length} Zeilen erkannt
                </p>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-800 mb-2">CSV-Format</h4>
              <pre className="text-xs text-blue-700 whitespace-pre-wrap font-mono">
                {CSV_FORMAT_HELP}
              </pre>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start">
                <XCircleIcon className="h-5 w-5 text-red-500 mr-2 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4">
              <Button variant="secondary" onClick={handleClose}>
                Abbrechen
              </Button>
              <Button
                onClick={handleValidate}
                disabled={!csvContent}
                loading={isLoading}
              >
                Validieren
              </Button>
            </div>
          </div>
        );

      case 'validate':
        return (
          <div className="space-y-4">
            {validationResult && (
              <>
                {/* Summary */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">
                      {validationResult.totalLines}
                    </p>
                    <p className="text-xs text-gray-500">Gesamt</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-600">
                      {validationResult.toCreate}
                    </p>
                    <p className="text-xs text-gray-500">Neu</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {validationResult.toUpdate}
                    </p>
                    <p className="text-xs text-gray-500">Update</p>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-yellow-600">
                      {validationResult.toSkip}
                    </p>
                    <p className="text-xs text-gray-500">Übersprungen</p>
                  </div>
                </div>

                {/* Errors */}
                {validationResult.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-red-800 mb-2 flex items-center">
                      <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
                      {validationResult.errors.length} Fehler gefunden
                    </h4>
                    <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
                      {validationResult.errors.map((err, i) => (
                        <li key={i}>
                          Zeile {err.line}: {err.hostname && `${err.hostname} - `}
                          {err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Preview */}
                {validationResult.preview.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b">
                      <h4 className="text-sm font-medium text-gray-700">
                        Vorschau (erste 10 Einträge)
                      </h4>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                              #
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                              Hostname
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                              MAC
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                              Aktion
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {validationResult.preview.slice(0, 10).map((item) => (
                            <tr key={item.line}>
                              <td className="px-3 py-2 text-xs text-gray-500">
                                {item.line}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {item.hostname}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                                {item.mac}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex px-2 py-0.5 text-xs rounded-full ${
                                    item.action === 'create'
                                      ? 'bg-green-100 text-green-700'
                                      : item.action === 'update'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-gray-100 text-gray-700'
                                  }`}
                                >
                                  {item.action === 'create'
                                    ? 'Neu'
                                    : item.action === 'update'
                                    ? 'Update'
                                    : 'Skip'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="secondary" onClick={() => setStep('upload')}>
                Zurück
              </Button>
              <div className="flex space-x-3">
                <Button variant="secondary" onClick={handleClose}>
                  Abbrechen
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!validationResult?.valid}
                  loading={isLoading}
                >
                  Importieren
                </Button>
              </div>
            </div>
          </div>
        );

      case 'result':
        return (
          <div className="space-y-4">
            {importResult && (
              <>
                <div
                  className={`rounded-lg p-6 text-center ${
                    importResult.success ? 'bg-green-50' : 'bg-red-50'
                  }`}
                >
                  {importResult.success ? (
                    <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  ) : (
                    <XCircleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
                  )}
                  <h3
                    className={`text-xl font-semibold ${
                      importResult.success ? 'text-green-800' : 'text-red-800'
                    }`}
                  >
                    {importResult.success ? 'Import erfolgreich!' : 'Import fehlgeschlagen'}
                  </h3>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-green-600">
                      {importResult.created}
                    </p>
                    <p className="text-sm text-gray-600">Erstellt</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-blue-600">
                      {importResult.updated}
                    </p>
                    <p className="text-sm text-gray-600">Aktualisiert</p>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-yellow-600">
                      {importResult.skipped}
                    </p>
                    <p className="text-sm text-gray-600">Übersprungen</p>
                  </div>
                </div>

                {importResult.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-red-800 mb-2">
                      {importResult.errors.length} Fehler
                    </h4>
                    <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
                      {importResult.errors.map((err, i) => (
                        <li key={i}>
                          Zeile {err.line}: {err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end pt-4">
              <Button onClick={handleClose}>Schließen</Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const getTitle = () => {
    switch (step) {
      case 'upload':
        return 'Hosts importieren';
      case 'validate':
        return 'Import-Vorschau';
      case 'result':
        return 'Import-Ergebnis';
      default:
        return 'Hosts importieren';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={getTitle()} size="lg">
      {/* Step indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-center space-x-4">
          {['upload', 'validate', 'result'].map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s
                    ? 'bg-primary-600 text-white'
                    : ['upload', 'validate', 'result'].indexOf(step) > i
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {['upload', 'validate', 'result'].indexOf(step) > i ? (
                  <CheckCircleIcon className="h-5 w-5" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 2 && (
                <div
                  className={`w-16 h-1 mx-2 ${
                    ['upload', 'validate', 'result'].indexOf(step) > i
                      ? 'bg-green-500'
                      : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-center space-x-8 mt-2 text-xs text-gray-500">
          <span>Datei</span>
          <span>Prüfen</span>
          <span>Fertig</span>
        </div>
      </div>

      {renderStep()}
    </Modal>
  );
}
