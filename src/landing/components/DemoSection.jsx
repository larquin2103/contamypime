import { LANDING_CONTENT } from '../content';

export function DemoSection() {
  const { demo } = LANDING_CONTENT;

  return (
    <section className="landing-section" id="demo-section">
      <h2 className="landing-section__title">{demo.heading}</h2>
      <p className="landing-section__subtitle">{demo.subheading}</p>
      <div className="demo-carousel">
        {demo.screenshots.map((screenshot) => (
          <div key={screenshot.id} className="demo-card">
            <div className="demo-card__image">
              {/* Las imágenes se cargarán aquí con Bloom */}
              <span>📱 Screenshot {screenshot.id}</span>
            </div>
            <h3 className="demo-card__title">{screenshot.title}</h3>
            <p className="demo-card__desc">{screenshot.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
