import { Modal, Button } from '@/components/ui';

interface DhcpPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  title?: string;
}

export function DhcpPreviewModal({ isOpen, onClose, content, title = 'DHCP Config Vorschau' }: DhcpPreviewModalProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-[60vh] overflow-y-auto">
        {content}
      </pre>
      <div className="flex justify-end pt-4 space-x-3">
        <Button variant="ghost" onClick={handleCopy}>
          Kopieren
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Schliessen
        </Button>
      </div>
    </Modal>
  );
}
