export function BusyOverlay({ label }: { label: string }) {
    return (
        <div
            aria-live="polite"
            className="fixed inset-0 z-50 grid place-items-center bg-busy-backdrop p-4"
            role="status"
        >
            <div className="grid w-[min(360px,100%)] max-w-[calc(100vw-2rem)] grid-cols-[auto_minmax(0,1fr)] items-center gap-[0.85rem] rounded-panel border border-line bg-panel p-4 shadow-panel">
                <div
                    aria-hidden="true"
                    className="size-[1.7rem] animate-spin rounded-full border-[3px] border-line border-t-brand [animation-duration:0.8s]"
                />
                <div>
                    <strong>{label}</strong>
                    <p className="m-0 mt-[0.2rem] text-muted-foreground">Keep this tab open.</p>
                </div>
            </div>
        </div>
    );
}
