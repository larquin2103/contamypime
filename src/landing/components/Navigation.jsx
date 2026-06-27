import { LANDING_CONTENT } from '../content';

export function Navigation() {
  const handleDownload = () => {
    // TODO: Link a APK o Play Store
    window.alert('Redirección a descarga (será integrado con Firebase)');
  };

  return (
    <nav className="landing-nav">
      <a href="#" className="landing-nav__logo">
        📊 MypiCuadre
      </a>
      <button className="landing-nav__cta" onClick={handleDownload}>
        {LANDING_CONTENT.hero.cta_primary}
      </button>
    </nav>
  );
}
