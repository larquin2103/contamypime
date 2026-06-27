import { LANDING_CONTENT } from '../content';

export function Footer() {
  const { footer } = LANDING_CONTENT;

  return (
    <footer className="landing-footer">
      <div className="landing-footer__container">
        <div className="landing-footer__section">
          <h3>MypiCuadre</h3>
          <p style={{ fontSize: '14px', color: '#93a7c6', margin: 0 }}>
            {footer.tagline}
          </p>
        </div>

        <div className="landing-footer__section">
          <h3>Legal</h3>
          <div className="landing-footer__links">
            {footer.links.legal.map((link, i) => (
              <a key={i} href={link.href} className="landing-footer__link">
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="landing-footer__section">
          <h3>Contacto</h3>
          <a href={`mailto:${footer.contact}`} className="landing-footer__link">
            {footer.contact}
          </a>
        </div>
      </div>

      <div className="landing-footer__bottom">
        © 2026 MypiCuadre. Todos los derechos reservados. • Hecho con ❤️ en Cuba
      </div>
    </footer>
  );
}
