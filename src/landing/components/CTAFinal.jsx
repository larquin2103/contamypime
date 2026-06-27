import { LANDING_CONTENT } from '../content';

export function CTAFinal() {
  const { cta_final } = LANDING_CONTENT;

  return (
    <section className="cta-final">
      <h2 className="cta-final__heading">{cta_final.heading}</h2>
      <p className="cta-final__subheading">{cta_final.subheading}</p>
      <button
        className="cta-final__cta"
        onClick={() => window.alert('Activar: será integrado')}
      >
        {cta_final.cta}
      </button>
    </section>
  );
}
