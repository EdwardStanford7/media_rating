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
        <form
            className="fixed right-4 bottom-4 z-50 grid w-[min(26rem,calc(100vw-2rem))] grid-cols-[minmax(0,1fr)] items-stretch gap-[0.6rem] rounded-panel border border-line border-l-4 border-l-brand bg-panel p-[0.65rem] shadow-floating"
            onSubmit={(event) => void onImport(event)}
        >
            <div className="flex items-center justify-between gap-3">
                <strong>Import Spreadsheet</strong>
                <IconButton
                    disabled={busy}
                    icon="close"
                    label="Close import"
                    size="sm"
                    type="button"
                    onClick={onClose}
                />
            </div>
            <label className="grid min-w-0 content-start gap-[0.35rem]">
                <span className="text-muted-foreground">First consumed date</span>
                <input disabled={disabled} name="firstConsumedAt" type="date" />
            </label>
            <label className="grid min-w-0 content-start gap-[0.35rem]">
                <span className="text-muted-foreground">Workbook</span>
                <input disabled={disabled} name="workbook" type="file" accept=".xlsx" />
            </label>
            <button disabled={disabled} type="submit">
                {busyLabel?.startsWith("Import") ? "Importing..." : "Import"}
            </button>
        </form>
    );
}
