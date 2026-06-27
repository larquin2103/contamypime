import '../styles/landing.css';
import { Navigation } from '../components/Navigation';
import { HeroSection } from '../components/HeroSection';
import { ProblemSection } from '../components/ProblemSection';
import { SolutionSection } from '../components/SolutionSection';
import { FeaturesSection } from '../components/FeaturesSection';
import { DemoSection } from '../components/DemoSection';
import { TestimonialsSection } from '../components/TestimonialsSection';
import { PricingSection } from '../components/PricingSection';
import { FAQSection } from '../components/FAQSection';
import { CTAFinal } from '../components/CTAFinal';
import { Footer } from '../components/Footer';

export function LandingPage() {
  return (
    <div className="landing">
      <Navigation />
      <main>
        <HeroSection />
        <ProblemSection />
        <SolutionSection />
        <FeaturesSection />
        <DemoSection />
        <TestimonialsSection />
        <PricingSection />
        <FAQSection />
      </main>
      <CTAFinal />
      <Footer />
    </div>
  );
}
