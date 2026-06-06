export function BusyOverlay({ label }: { label: string }) {
    return (
        <div aria-live="polite" className="busy-overlay" role="status">
            <div className="busy-card">
                <div aria-hidden="true" className="spinner" />
                <div>
                    <strong>{label}</strong>
                    <p className="muted">Keep this tab open.</p>
                </div>
            </div>
        </div>
    );
}
