import { LANDING_CONTENT } from '../content';
import { getIconComponent } from '../../lib/icons';

export function FeaturesSection() {
  const { features } = LANDING_CONTENT;

  return (
    <section className="landing-section">
      <h2 className="landing-section__title">{features.heading}</h2>
      <div className="features-grid">
        {features.items.map((feature, i) => (
          <div key={i} className="feature-card">
            <div className="feature-card__icon">
              {getIconComponent(feature.icon)}
            </div>
            <h3 className="feature-card__title">{feature.title}</h3>
            <p className="feature-card__desc">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
