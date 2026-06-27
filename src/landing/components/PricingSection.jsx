import { LANDING_CONTENT } from '../content';

export function PricingSection() {
  const { pricing } = LANDING_CONTENT;

  return (
    <section className="landing-section">
      <h2 className="landing-section__title">{pricing.heading}</h2>
      <div className="pricing-grid">
        {pricing.items.map((plan, i) => (
          <div
            key={i}
            className={`pricing-card ${plan.highlighted ? 'is-highlighted' : ''}`}
          >
            <h3 className="pricing-card__name">{plan.name}</h3>
            <p className="pricing-card__period">{plan.period}</p>

            {plan.price && (
              <div className="pricing-card__price">
                <span className="pricing-card__amount">${plan.price}</span>
                <span className="pricing-card__currency">USD</span>
              </div>
            )}

            <ul className="pricing-card__features">
              {plan.features.map((feature, j) => (
                <li key={j} className="pricing-card__feature">
                  {feature}
                </li>
              ))}
            </ul>

            <button
              className={`pricing-card__cta ${
                plan.highlighted ? 'pricing-card__cta--primary' : 'pricing-card__cta--secondary'
              }`}
              onClick={() => window.alert('Contratación: será integrado')}
            >
              {plan.cta}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
