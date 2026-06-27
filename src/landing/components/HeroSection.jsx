import { LANDING_CONTENT } from '../content';
import { LANDING_ASSETS } from '../assets';

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
      <img
        src={LANDING_ASSETS.hero.url}
        alt={LANDING_ASSETS.hero.alt}
        style={{
          maxWidth: '100%',
          height: 'auto',
          marginBottom: '40px',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        }}
      />
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
