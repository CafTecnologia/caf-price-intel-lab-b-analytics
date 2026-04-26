import Link from "next/link";

export function NavigationTabs(props: { documentId: string; current: "processing" | "results" | "batches" | "odoo" }) {
  const links = [
    { key: "processing", href: `/documents/${props.documentId}/processing`, label: "Processing" },
    { key: "results", href: `/documents/${props.documentId}/results`, label: "Results" },
    { key: "batches", href: `/documents/${props.documentId}/batches`, label: "Batch Review" },
    { key: "odoo", href: `/documents/${props.documentId}/odoo-preview`, label: "Odoo Preview" },
  ] as const;

  return (
    <nav className="tab-bar">
      {links.map((link) => (
        <Link key={link.key} href={link.href} className={link.key === props.current ? "tab active" : "tab"}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
