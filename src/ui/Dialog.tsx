import {
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "./primitives";

/** Controlled native modal. Children stay mounted so errors or rerenders preserve form drafts. */
export type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: DialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descriptionId} className="text-muted">
              {description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          className="dialog-close"
          onClick={onClose}
          aria-label="Закрыть диалог"
        >
          ×
        </Button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
