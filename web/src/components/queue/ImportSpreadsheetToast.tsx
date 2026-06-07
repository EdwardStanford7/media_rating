import type { FormEvent } from "react";
import { IconButton } from "@/components/ui/Icon";

export function ImportSpreadsheetToast({
    busy,
    busyLabel,
    disabled,
    onClose,
    onImport
}: {
    busy: boolean;
    busyLabel: string | null;
    disabled: boolean;
    onClose: () => void;
    onImport: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
    return (
        <form className="toast import-toast" onSubmit={(event) => void onImport(event)}>
            <div className="toast-header-row">
                <strong>Import Spreadsheet</strong>
                <IconButton
                    className="toast-close-button"
                    disabled={busy}
                    icon="close"
                    label="Close import"
                    type="button"
                    onClick={onClose}
                />
            </div>
            <label className="stack compact-stack">
                <span className="muted">First consumed date</span>
                <input disabled={disabled} name="firstConsumedAt" type="date" />
            </label>
            <label className="stack compact-stack">
                <span className="muted">Workbook</span>
                <input disabled={disabled} name="workbook" type="file" accept=".xlsx" />
            </label>
            <button disabled={disabled} type="submit">
                {busyLabel?.startsWith("Import") ? "Importing..." : "Import"}
            </button>
        </form>
    );
}
