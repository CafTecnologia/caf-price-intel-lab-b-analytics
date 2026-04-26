export function StatusPill(props: { status: string }) {
  return <span className={`status-pill status-${props.status.replace(/[^a-z_]+/gi, "-")}`}>{props.status}</span>;
}
