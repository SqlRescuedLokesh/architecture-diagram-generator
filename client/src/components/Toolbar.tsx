interface ToolbarProps {
  disabled: boolean;
  exporting?: boolean;
  onDownloadPptx: () => void;
}

export function Toolbar({ disabled, exporting, onDownloadPptx }: ToolbarProps) {
  return (
    <div className="toolbar">
      <button disabled={disabled} onClick={onDownloadPptx}>
        {exporting ? "Exporting…" : "Download PPTX"}
      </button>
    </div>
  );
}
