import { LANDING_CONTENT } from '../content';

export function HeroSection() {
  const { hero } = LANDING_CONTENT;

  const handlePrimary = () => {
    window.alert('Iniciar descarga (será integrado)');
  };

  const handleDemo = () => {
    const demoSection = document.getElementById('demo-section');
    demoSection?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="hero">
      <h1 className="hero__heading">{hero.heading}</h1>
      <p className="hero__subheading">{hero.subheading}</p>
      <div className="hero__ctas">
        <button className="hero__cta-btn hero__cta-btn--primary" onClick={handlePrimary}>
          {hero.cta_primary}
        </button>
        <button className="hero__cta-btn hero__cta-btn--secondary" onClick={handleDemo}>
          {hero.cta_secondary}
        </button>
      </div>
    </section>
  );
}
