import Link from "next/link";
import { HelpCenter } from "../../components/help-center";

export default function HelpPage() {
  return (
    <main className="help-page">
      <header className="help-header">
        <div><p>Ayuda del simulador</p><h1>Construye y compara tu oferta</h1><span>Guía breve, cálculos y controles del sistema.</span></div>
        <Link className="button" href="/">Volver al simulador</Link>
      </header>
      <HelpCenter />
    </main>
  );
}
