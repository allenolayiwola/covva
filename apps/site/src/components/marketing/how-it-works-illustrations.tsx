import Image from "next/image";

/**
 * Illustrations for the three "How it works" steps on the home page, in the same painterly style as the home hero
 * (public/images/how-it-works/, see its README). Decorative: the step heading and text carry the meaning, so the
 * images have empty alt text. They sit below the first screen, so they load lazily.
 */
function StepIllustration({ src, className }: { src: string; className?: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={2048}
      height={1360}
      quality={85}
      sizes="(max-width: 767px) calc(100vw - 72px), (max-width: 1279px) 30vw, 400px"
      className={className}
    />
  );
}

export function CompareIllustration({ className }: { className?: string }) {
  return <StepIllustration src="/images/how-it-works/compare.webp" className={className} />;
}

export function PayIllustration({ className }: { className?: string }) {
  return <StepIllustration src="/images/how-it-works/pay.webp" className={className} />;
}

export function PolicyIllustration({ className }: { className?: string }) {
  return <StepIllustration src="/images/how-it-works/policy.webp" className={className} />;
}
