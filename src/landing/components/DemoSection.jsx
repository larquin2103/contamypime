import { LANDING_CONTENT } from '../content';
import { LANDING_ASSETS } from '../assets';

export function DemoSection() {
  const { demo } = LANDING_CONTENT;

  const demoImages = [
    LANDING_ASSETS.demo.pos,
    LANDING_ASSETS.demo.cashReconciliation,
    LANDING_ASSETS.dashboard,
    LANDING_ASSETS.offlineSecurity,
  ];

  return (
    <section className="landing-section" id="demo-section">
      <h2 className="landing-section__title">{demo.heading}</h2>
      <p className="landing-section__subtitle">{demo.subheading}</p>
      <div className="demo-carousel">
        {demoImages.map((image, i) => (
          <div key={i} className="demo-card">
            <img
              src={image.url}
              alt={image.alt}
              className="demo-card__image"
              style={{
                width: '100%',
                height: 'auto',
                borderRadius: '12px',
                marginBottom: '12px',
                objectFit: 'cover',
              }}
            />
            <h3 className="demo-card__title">{image.title}</h3>
            <p className="demo-card__desc">{image.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
